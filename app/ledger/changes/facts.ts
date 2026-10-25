// The shapes every extractor shares: a fact, the context it is read in, and
// the folding of files into module groups. Each language's reader builds
// facts with these helpers, so edges from TypeScript, Go and Python fold
// into one graph.

import { posix } from "node:path";

export type Kind =
  | "dependency"
  | "import-edge"
  | "module"
  | "service"
  | "port"
  | "script"
  | "engine";

export type Fact = {
  kind: Kind;
  // unique within its kind across the repo; facts with the same key fold
  // into one node or edge
  key: string;
  // a noun phrase a statement is built from
  text: string;
  // compared across versions for "changed"; absent for plain presence
  value?: string;
  // repo-relative path the fact was read from
  file: string;
  // low signal: an edge to a language's standard library or builtins, or a
  // dependency only pulled in by another (Go's "// indirect")
  low?: "stdlib" | "indirect";
};

export type FileKind =
  "source" | "manifest" | "compose" | "go" | "gomod" | "python" | "pydeps";

export type Alias = {
  // directory whose files the alias applies to ("" = the whole repo)
  scope: string;
  // the pattern before its "*" ("@shared/", or "config" for an exact alias)
  prefix: string;
  exact: boolean;
  // repo-relative replacements, also without their "*"
  targets: string[];
};

export type GoModule = {
  // the go.mod's directory, repo-relative ("" = the repo root)
  dir: string;
  // its `module` path
  path: string;
};

export type Context = {
  // how many directory levels a module group keeps
  depth?: number;
  aliases?: Alias[];
  // whether a repo-relative path is a file, for extensionless imports
  exists?: (rel: string) => boolean;
  // whether a repo-relative path is a directory, for Go and Python packages
  isDir?: (rel: string) => boolean;
  goModules?: GoModule[];
  // module paths from every go.mod's require lines, to name external imports
  goRequires?: string[];
  // more directories Python imports resolve from (a Lambda layer's python/)
  pyRoots?: string[];
};

// A file's group: its directory cut to `depth` levels, so imports between
// files fold into edges between parts of the system (app/server → app/layer).
export function groupOf(rel: string, depth = 2): string {
  return groupOfDir(posix.dirname(rel), depth);
}

export function groupOfDir(dir: string, depth = 2): string {
  if (dir === "." || dir === "" || dir === "/") return ".";
  return dir.split("/").slice(0, depth).join("/");
}

// What an import names: a group inside the repo, or a package outside it
// (`low` for a standard library).
export type Target = { group: string } | { pkg: string; low?: boolean };

// A source file's facts: its module, and an edge for each import that leaves
// its group.
export function moduleFacts(
  rel: string,
  targets: Iterable<Target>,
  ctx: Context,
  withModule = true,
): Fact[] {
  const from = groupOf(rel, ctx.depth ?? 2);
  const facts = new Map<string, Fact>();
  if (withModule)
    facts.set("", {
      kind: "module",
      key: from,
      text: `module ${from}`,
      file: rel,
    });
  for (const t of targets) {
    if ("group" in t) {
      if (t.group === from) continue;
      const key = `${from} → ${t.group}`;
      facts.set(key, {
        kind: "import-edge",
        key,
        text: `import edge ${key}`,
        file: rel,
      });
    } else {
      const key = `${from} → ${t.pkg}`;
      facts.set(key, {
        kind: "import-edge",
        key,
        text: `import edge ${from} → ${t.low ? "standard library" : "package"} ${t.pkg}`,
        file: rel,
        ...(t.low ? { low: "stdlib" as const } : {}),
      });
    }
  }
  return [...facts.values()];
}

export function depFact(
  rel: string,
  section: string,
  name: string,
  v: string,
): Fact {
  return {
    kind: "dependency",
    key: `${rel}#${section}#${name}`,
    text: `dependency ${name} (${section}, ${rel})`,
    value: v,
    file: rel,
  };
}

export function engineFact(rel: string, name: string, v: string): Fact {
  return {
    kind: "engine",
    key: `${rel}#engine#${name}`,
    text: `engine ${name} (${rel})`,
    value: v,
    file: rel,
  };
}
