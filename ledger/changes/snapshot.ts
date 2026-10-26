// What changed in your system during a chat, captured live with no model:
// the working tree is committed into a shadow git repository of our own at
// each turn's edges, and two snapshots' facts (imports, dependencies,
// services) are compared. Your own `.git` and index are never touched.
//
// Only inside a git work tree; your .gitignore and .git/info/exclude apply;
// files over 1 MB, binaries and anything that looks like a secret are left
// out, so they are never copied into ~/.living-map/shadow.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Alias, Context, Fact, GoModule } from "./facts.ts";
import { extract, fileKind, goModInfo, parseAliases } from "./graph.ts";
import { diffGraphs, type Statement } from "./rules.ts";

const MAX_BYTES = 1_000_000;
const SECRET =
  /(?:^|\/)(?:\.env(?:\.[\w.-]+)?|[^/]*\.(?:pem|key|p12|pfx|keystore|jks)|id_(?:rsa|ed25519|ecdsa)[^/]*|[^/]*(?:credential|secret|token)[^/]*\.(?:json|ya?ml|txt|ini|cfg))$/i;
const BINARY =
  /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|bz2|xz|7z|jar|war|class|so|dylib|dll|exe|bin|wasm|mp[34]|mov|avi|woff2?|ttf|otf|eot|sqlite|db|lock)$/i;

export type Shadow = { root: string; gitDir: string };

// git as these calls ask, never steered by the GIT_ variables of whatever
// started the server: inside a git hook GIT_INDEX_FILE names the work tree's
// own index, and the snapshot's `add` would stage into it
export const gitEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );

const git = (sh: Shadow, args: string[], input?: string) =>
  execFileSync(
    "git",
    [
      `--git-dir=${sh.gitDir}`,
      `--work-tree=${sh.root}`,
      "-c",
      `core.excludesFile=${path.join(sh.root, ".git", "info", "exclude")}`,
      "-c",
      "user.name=Living Map",
      "-c",
      "user.email=living-map@localhost",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      maxBuffer: 256 * 1024 * 1024,
      input,
      stdio: ["pipe", "pipe", "ignore"],
      env: gitEnv(),
    },
  ).toString();

// The shadow repository for the work tree `cwd` is in, or null when it is in
// none (a home folder, a notes vault: nothing is snapshotted there).
export function shadowFor(home: string, cwd: string): Shadow | null {
  let root: string;
  try {
    root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"],
      env: gitEnv(),
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
  if (!root) return null;
  const id = crypto.createHash("sha1").update(root).digest("hex").slice(0, 16);
  const gitDir = path.join(home, "shadow", id);
  if (!fs.existsSync(path.join(gitDir, "HEAD"))) {
    fs.mkdirSync(gitDir, { recursive: true, mode: 0o700 });
    execFileSync("git", ["init", "--bare", "-q", gitDir], {
      stdio: "ignore",
      env: gitEnv(),
    });
    fs.writeFileSync(path.join(gitDir, "living-map-root"), root);
  }
  return { root, gitDir };
}

// what may be copied: not secret-looking, not binary, not over 1 MB
function keep(sh: Shadow, rel: string): boolean {
  if (SECRET.test(rel) || BINARY.test(rel)) return false;
  try {
    const st = fs.statSync(path.join(sh.root, rel));
    return st.isFile() && st.size <= MAX_BYTES;
  } catch {
    return false;
  }
}

// Commits the work tree as it is now; returns the commit, or null when the
// tree can't be read. Deleted files leave the snapshot too.
export function snapshot(sh: Shadow, label: string): string | null {
  try {
    const listed = git(sh, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ])
      .split("\0")
      .filter(Boolean);
    const present = listed.filter((rel) => keep(sh, rel));
    const gone = git(sh, ["ls-files", "-z", "--deleted"])
      .split("\0")
      .filter(Boolean);
    const paths = [...new Set([...present, ...gone])];
    if (paths.length)
      git(
        sh,
        ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
        paths.join("\0"),
      );
    // a file kept before and left out now (it grew past 1 MB, or became
    // secret-looking) leaves the index too
    const staged = git(sh, ["ls-files", "-z", "--cached"])
      .split("\0")
      .filter(Boolean);
    const drop = staged.filter(
      (rel) => !present.includes(rel) && !gone.includes(rel),
    );
    if (drop.length)
      git(
        sh,
        [
          "rm",
          "-q",
          "--cached",
          "--pathspec-from-file=-",
          "--pathspec-file-nul",
        ],
        drop.join("\0"),
      );
    git(sh, ["commit", "-q", "--allow-empty", "-m", label]);
    return git(sh, ["rev-parse", "HEAD"]).trim();
  } catch {
    return null;
  }
}

// facts per file content, computed once per blob whatever snapshot holds it
const factCache = new Map<string, Fact[] | null>();

type Tree = Map<string, string>; // repo-relative path → blob
function treeOf(sh: Shadow, commit: string): Tree {
  const out: Tree = new Map();
  for (const line of git(sh, ["ls-tree", "-r", "-z", commit]).split("\0")) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m) out.set(m[2]!, m[1]!);
  }
  return out;
}

const blob = (sh: Shadow, sha: string) => git(sh, ["cat-file", "blob", sha]);

function dirsOf(files: Iterable<string>) {
  const dirs = new Set<string>();
  for (const f of files)
    for (
      let d = path.posix.dirname(f);
      d !== "." && !dirs.has(d);
      d = path.posix.dirname(d)
    )
      dirs.add(d);
  return dirs;
}

// Everything a file's imports resolve against, read from one snapshot.
function contextOf(sh: Shadow, tree: Tree): Context {
  const files = new Set(tree.keys());
  const dirs = dirsOf(files);
  const aliases: Alias[] = [];
  const goModules: GoModule[] = [];
  const goRequires: string[] = [];
  for (const [rel, sha] of tree) {
    if (
      /(?:^|\/)[tj]sconfig(?:\.[\w-]+)?\.json$/.test(rel) &&
      !rel.includes("node_modules/")
    )
      aliases.push(...parseAliases(blob(sh, sha), rel));
    if (path.posix.basename(rel) === "go.mod") {
      const info = goModInfo(blob(sh, sha));
      const dir = path.posix.dirname(rel);
      if (info.module)
        goModules.push({ dir: dir === "." ? "" : dir, path: info.module });
      goRequires.push(...info.requires);
    }
  }
  return {
    aliases,
    exists: (r) => files.has(r),
    isDir: (r) => dirs.has(r),
    goModules,
    goRequires,
    pyRoots: [...dirs].filter((d) => path.posix.basename(d) === "python"),
  };
}

function factsOf(sh: Shadow, tree: Tree): Fact[] {
  const ctx = contextOf(sh, tree);
  const out: Fact[] = [];
  for (const [rel, sha] of tree) {
    if (!fileKind(rel)) continue;
    // a blob's facts depend on its path and the repo's layout as well
    const key = `${rel}:${sha}`;
    let facts = factCache.get(key);
    if (facts === undefined) {
      facts = extract(rel, blob(sh, sha), ctx);
      factCache.set(key, facts);
    }
    if (facts) out.push(...facts);
  }
  return out;
}

export type Compared = {
  statements: Statement[];
  changed: { file: string; status: string; readable: boolean }[];
};

// What changed between two snapshots: statements from the whole tree's facts
// on each side (an import one file drops is not "removed" while another file
// still has it), and every changed file, readable by a reader or not.
export function compare(
  sh: Shadow,
  a: string,
  b: string,
  turn?: number,
): Compared {
  const changed = git(sh, ["diff", "--name-status", "--no-renames", "-z", a, b])
    .split("\0")
    .filter(Boolean)
    .reduce<{ file: string; status: string; readable: boolean }[]>(
      (acc, x, i, all) => {
        // name-status -z gives "status\0path\0" pairs
        if (i % 2 === 0)
          acc.push({
            status: x,
            file: all[i + 1] ?? "",
            readable: !!fileKind(all[i + 1] ?? ""),
          });
        return acc;
      },
      [],
    );
  if (!changed.some((c) => c.readable)) return { statements: [], changed };
  const statements = diffGraphs(
    factsOf(sh, treeOf(sh, a)),
    factsOf(sh, treeOf(sh, b)),
  );
  if (turn !== undefined)
    for (const s of statements) for (const e of s.evidence) e.turn ??= turn;
  return { statements, changed };
}
