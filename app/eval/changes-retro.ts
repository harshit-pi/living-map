// Retro for the what-changed view: do normal sessions change enough of a
// system's structure for the view to matter? It rebuilds, from past Claude
// Code transcripts and with no model calls, each file's contents before and
// after every Edit, Write and Bash call, runs the extractors and rules on
// them, and writes a markdown report of paths and statement lines only: no
// file contents, and values that look like secrets masked.
//
//   node eval/changes-retro.ts [N] [out.md]     (N defaults to 20)
//
// Reads ~/.claude/projects and ~/.claude/file-history, and the current tree
// of each session's repo: as the baseline for files the session never
// touched, and as the end state that later edits are stepped back from.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import {
  type Alias,
  applyHunks,
  type Context,
  extract,
  type Fact,
  fileKind,
  type Hunk,
  hunkFacts,
  hunkShape,
  hunkSide,
  invertHunks,
  parseAliases,
} from "../ledger/changes/graph.ts";
import {
  attach,
  type ChangedFile,
  diffGraphs,
  type Evidence,
  explain,
  extensionOf,
  noStructuralChange,
  type Statement,
  type Verdict,
} from "../ledger/changes/rules.ts";

const N = Number(process.argv[2]) || 20;
const OUT =
  process.argv[3] ??
  "/private/tmp/claude-501/-Users-harshit-Library-Application-Support-Claude-scratch-workspaces-97bbd5f9-5474-4169-a5c8-a1581ac76d8b-47bdff2a-badd-45d0-9887-d133deb3d9ff-scratch-2026-10-23-7c759e/8110f9da-1e9b-4269-b9d5-2a743e0e6d33/scratchpad/research/9-changes-retro.md";
const CLAUDE = path.join(os.homedir(), ".claude");
const PROJECTS = path.join(CLAUDE, "projects");
const HISTORY = path.join(CLAUDE, "file-history");
const MAX_FILE = 1_000_000;

type Raw = Record<string, unknown>;

// ---------------------------------------------------------------- reading

type Edit = { old: string; new: string; all: boolean };

// A change one tool call made to one file.
type Step = {
  type: "step";
  at: string;
  seq: number;
  id: string;
  tool: string;
  abs: string;
  // originalFile, when the result carried it
  original?: string;
  create?: boolean;
  // Write's new contents
  content?: string;
  hunks?: Hunk[];
  edits?: Edit[];
  // Bash said it changed the file but kept no diff
  opaque?: boolean;
};
// A moment the file's whole contents are known: a full Read, or a
// file-history backup (content null: the file did not exist then).
type Seen = {
  type: "seen";
  at: string;
  seq: number;
  abs: string;
  from: "read" | "backup";
  content?: string;
  backup?: string | null;
};
type Bash = {
  type: "bash";
  at: string;
  seq: number;
  command: string;
  tracked: boolean;
  flags: string[];
};
type Event = Step | Seen | Bash;

type Session = {
  id: string;
  mtime: number;
  cwds: Map<string, number>;
  prompts: string[];
  events: Event[];
  stats: { fileResults: number; nullOriginal: number };
};

const SKIP_TYPES = new Set([
  "api-request",
  "api-request-blob",
  "api-request-shape",
  "queue-operation",
  "last-prompt",
  "custom-title",
  "bridge-session",
  "agent-name",
  "atis-latch",
  "ai-title",
  "pr-link",
  "mode",
  "cost-state",
  "summary",
]);

async function eachLine(file: string, f: (o: Raw) => void) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    // metadata lines can be megabytes; skip them before parsing
    const t = line.startsWith('{"type":"')
      ? line.slice(9, line.indexOf('"', 9))
      : "";
    if (SKIP_TYPES.has(t)) continue;
    try {
      f(JSON.parse(line));
    } catch {
      // a torn last line of a live session
    }
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function hunksOf(v: unknown): Hunk[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(
    (h): h is Hunk =>
      !!h &&
      typeof h === "object" &&
      typeof (h as Hunk).oldStart === "number" &&
      Array.isArray((h as Hunk).lines),
  );
  return out.length ? out : undefined;
}

function isPrompt(o: Raw): boolean {
  if (o.type !== "user" || o.isSidechain || o.isMeta || o.isCompactSummary)
    return false;
  if (o.toolUseResult !== undefined) return false;
  const c = (o.message as Raw | undefined)?.content;
  let text = "";
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b?.type === "tool_result")) return false;
    text = c
      .filter((b) => b?.type === "text")
      .map((b) => String(b.text))
      .join("\n");
  }
  const t = text.trimStart();
  return (
    !!t &&
    !/^<(?:local-command|task-notification|bash-stdout|bash-stderr)/.test(t) &&
    !t.startsWith("[Request interrupted")
  );
}

// Contents are kept only for kinds an extractor reads; for the rest the path
// is all the report needs.
const keep = (abs: string, text: string | undefined) =>
  fileKind(abs) && text !== undefined && text.length <= MAX_FILE
    ? text
    : undefined;

async function readSession(file: string): Promise<Session> {
  const id = path.basename(file, ".jsonl");
  const s: Session = {
    id,
    mtime: fs.statSync(file).mtimeMs,
    cwds: new Map(),
    prompts: [],
    events: [],
    stats: { fileResults: 0, nullOriginal: 0 },
  };
  const uses = new Map<string, { name: string; command?: string }>();
  const done = new Set<string>();
  const backups = new Set<string>();
  let seq = 0;
  let firstCwd = "";
  const subdir = path.join(path.dirname(file), id, "subagents");
  const subs = fs.existsSync(subdir)
    ? fs
        .readdirSync(subdir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => path.join(subdir, f))
    : [];

  const backup = (track: string, b: Raw | undefined) => {
    const at = str(b?.backupTime);
    if (!b || !at) return;
    const dir = str(b.realParentDir);
    const abs = dir
      ? path.join(dir, path.basename(track))
      : path.resolve(firstCwd || "/", track);
    const name = str(b.backupFileName) ?? null;
    const k = `${abs}\0${name}\0${at}`;
    if (backups.has(k) || !fileKind(abs)) return;
    backups.add(k);
    s.events.push({
      type: "seen",
      at,
      seq: seq++,
      abs,
      from: "backup",
      backup: name,
    });
  };

  for (const [n, f] of [file, ...subs].entries()) {
    const main = n === 0;
    await eachLine(f, (o) => {
      if (o.type === "file-history-delta")
        return backup(String(o.trackingPath ?? ""), o.backup as Raw);
      if (o.type === "file-history-snapshot") {
        const tracked = (o.snapshot as Raw | undefined)?.trackedFileBackups;
        for (const [k, b] of Object.entries((tracked as Raw) ?? {}))
          backup(k, b as Raw);
        return;
      }
      const at = str(o.timestamp) ?? "";
      const cwd = str(o.cwd);
      if (main && cwd) {
        firstCwd ||= cwd;
        s.cwds.set(cwd, (s.cwds.get(cwd) ?? 0) + 1);
      }
      if (main && isPrompt(o)) s.prompts.push(at);
      const msg = o.message as Raw | undefined;
      if (o.type === "assistant" && Array.isArray(msg?.content))
        for (const b of msg.content as Raw[])
          if (b?.type === "tool_use")
            uses.set(String(b.id), {
              name: String(b.name),
              command: str((b.input as Raw | undefined)?.command),
            });
      const tr = o.toolUseResult;
      if (!tr || typeof tr !== "object" || Array.isArray(tr)) return;
      const block = Array.isArray(msg?.content)
        ? (msg.content as Raw[]).find((b) => b?.type === "tool_result")
        : undefined;
      const useId = str(block?.tool_use_id) ?? "";
      // a result can be written twice (a resumed or forked session)
      if (useId && done.has(useId)) return;
      done.add(useId);
      s.events.push(
        ...toEvents(tr as Raw, uses.get(useId), useId, at, () => seq++, s),
      );
    });
  }
  s.events.sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
  return s;
}

function toEvents(
  r: Raw,
  use: { name: string; command?: string } | undefined,
  id: string,
  at: string,
  next: () => number,
  s: Session,
): Event[] {
  const name = use?.name ?? "";
  const filePath = str(r.filePath);
  if (filePath && ("structuredPatch" in r || "content" in r)) {
    s.stats.fileResults++;
    const original = str(r.originalFile);
    if (original === undefined) s.stats.nullOriginal++;
    const isWrite =
      name === "Write" || r.type === "create" || r.type === "update";
    const edits: Edit[] | undefined = Array.isArray(r.edits)
      ? (r.edits as Raw[]).map((e) => ({
          old: String(e.old_string ?? ""),
          new: String(e.new_string ?? ""),
          all: !!e.replace_all,
        }))
      : typeof r.oldString === "string"
        ? [
            {
              old: r.oldString,
              new: String(r.newString ?? ""),
              all: !!r.replaceAll,
            },
          ]
        : undefined;
    return [
      {
        type: "step",
        at,
        seq: next(),
        id,
        tool: name || (isWrite ? "Write" : "Edit"),
        abs: filePath,
        original: keep(filePath, original),
        create: r.type === "create",
        content: isWrite ? keep(filePath, str(r.content)) : undefined,
        hunks: hunksOf(r.structuredPatch),
        edits,
      },
    ];
  }
  const file = r.file as Raw | undefined;
  if (r.type === "text" && file && typeof file.content === "string") {
    const abs = str(file.filePath);
    const full =
      (file.startLine === 1 || file.startLine === undefined) &&
      file.numLines === file.totalLines;
    const content = abs && full ? keep(abs, file.content) : undefined;
    return abs && content !== undefined
      ? [{ type: "seen", at, seq: next(), abs, from: "read", content }]
      : [];
  }
  if (name === "NotebookEdit" && typeof r.notebook_path === "string")
    return [
      { type: "step", at, seq: next(), id, tool: name, abs: r.notebook_path },
    ];
  if (name !== "Bash" && !("stdout" in r)) return [];
  const d = r.bashEditDiff as Raw | undefined;
  const out: Event[] = [];
  const diffed = new Set<string>();
  for (const f of Array.isArray(d?.files) ? (d.files as Raw[]) : []) {
    const abs = str(f?.filePath);
    if (!abs) continue;
    diffed.add(abs);
    out.push({
      type: "step",
      at,
      seq: next(),
      id,
      tool: "Bash",
      abs,
      hunks: hunksOf(f.hunks) ?? [],
    });
  }
  const undiffed = (
    Array.isArray(d?.changedFiles) ? (d.changedFiles as unknown[]) : []
  ).filter((f): f is string => typeof f === "string" && !diffed.has(f));
  for (const abs of undiffed)
    out.push({
      type: "step",
      at,
      seq: next(),
      id,
      tool: "Bash",
      abs,
      opaque: true,
    });
  const flags = ["unavailable", "skipped", "shared"].filter((k) => d?.[k]);
  if (d && typeof d.moreFiles === "number" && d.moreFiles > undiffed.length)
    flags.push("moreFiles");
  out.push({
    type: "bash",
    at,
    seq: next(),
    command: use?.command ?? "",
    tracked: !!d,
    flags,
  });
  return out;
}

function readBackup(session: string, name: string): string | undefined {
  try {
    const p = path.join(HISTORY, session, name);
    return fs.statSync(p).size <= MAX_FILE
      ? fs.readFileSync(p, "utf8")
      : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- the repo

const rootCache = new Map<string, string | null>();
function repoRoot(cwd: string): string | null {
  if (rootCache.has(cwd)) return rootCache.get(cwd) ?? null;
  let root: string | null = null;
  try {
    if (fs.existsSync(cwd))
      root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
  } catch {
    root = null;
  }
  rootCache.set(cwd, root);
  return root;
}

// Today's contents of a repo file: undefined when too big or unreadable,
// null when it does not exist.
function readDisk(root: string, rel: string): string | null | undefined {
  const p = path.join(root, rel);
  try {
    if (!fs.existsSync(p)) return null;
    const st = fs.statSync(p);
    return st.isFile() && st.size <= MAX_FILE
      ? fs.readFileSync(p, "utf8")
      : undefined;
  } catch {
    return undefined;
  }
}

type Baseline = {
  files: Set<string>;
  facts: Map<string, Fact[]>;
  aliases: Alias[];
};

const baseCache = new Map<string, Baseline>();
// The current tree, read once per repo: the stand-in for files a session never
// touched, so an import one file drops is not called a removed edge when
// another file still has it.
function baseline(root: string): Baseline {
  const hit = baseCache.get(root);
  if (hit) return hit;
  const files = new Set(
    execFileSync(
      "git",
      [
        "-C",
        root,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ],
      { maxBuffer: 512 * 1024 * 1024 },
    )
      .toString()
      .split("\0")
      .filter(Boolean),
  );
  const aliases: Alias[] = [];
  for (const rel of files)
    if (
      /(?:^|\/)[tj]sconfig(?:\.[\w-]+)?\.json$/.test(rel) &&
      !rel.includes("node_modules/")
    ) {
      const t = readDisk(root, rel);
      if (t) aliases.push(...parseAliases(t, rel));
    }
  const ctx: Context = { aliases, exists: (r) => files.has(r) };
  const facts = new Map<string, Fact[]>();
  for (const rel of files) {
    if (!fileKind(rel)) continue;
    const t = readDisk(root, rel);
    const f = typeof t === "string" ? extract(rel, t, ctx) : null;
    if (f) facts.set(rel, f);
  }
  const b = { files, facts, aliases };
  baseCache.set(root, b);
  return b;
}

// Facts by file, indexed by what they are about so a diff can pull in the
// other files that hold the same edge or module.
class World {
  facts = new Map<string, Fact[]>();
  index = new Map<string, Map<string, Fact>>();
  set(rel: string, facts: Fact[]) {
    for (const f of this.facts.get(rel) ?? [])
      this.index.get(kk(f))?.delete(rel);
    this.facts.set(rel, facts);
    for (const f of facts) {
      let m = this.index.get(kk(f));
      if (!m) this.index.set(kk(f), (m = new Map()));
      m.set(rel, f);
    }
  }
  context(keys: Set<string>, exclude: Set<string>): Fact[] {
    const out: Fact[] = [];
    for (const k of keys)
      for (const [rel, f] of this.index.get(k) ?? [])
        if (!exclude.has(rel)) out.push(f);
    return out;
  }
}
const kk = (f: { kind: string; key: string }) => `${f.kind}\0${f.key}`;

type Change = { file: string; before: Fact[]; after: Fact[] };
function diffIn(world: World, changes: Change[]): Statement[] {
  const keys = new Set(
    changes.flatMap((c) => [...c.before, ...c.after]).map(kk),
  );
  const ctx = world.context(keys, new Set(changes.map((c) => c.file)));
  return diffGraphs(
    [...ctx, ...changes.flatMap((c) => c.before)],
    [...ctx, ...changes.flatMap((c) => c.after)],
  );
}

// ---------------------------------------------------------------- rebuilding

function applyEdit(before: string, e: Step): string | undefined {
  if (e.edits?.length) {
    let t: string | undefined = before;
    for (const x of e.edits) {
      if (!x.old || !t.includes(x.old)) {
        t = undefined;
        break;
      }
      if (x.all) t = t.split(x.old).join(x.new);
      else {
        const i = t.indexOf(x.old);
        t = t.slice(0, i) + x.new + t.slice(i + x.old.length);
      }
    }
    if (t !== undefined) return t;
  }
  return e.hunks ? (applyHunks(before, e.hunks) ?? undefined) : undefined;
}

// A step's result from the contents before it; undefined when it can't be
// worked out.
function forward(
  step: Step,
  before: string | null | undefined,
): string | null | undefined {
  if (step.content !== undefined) return step.content;
  if (step.opaque || !step.hunks?.length) return undefined;
  const shape = hunkShape(step.hunks);
  if (shape === "create") return hunkSide(step.hunks, "+");
  if (shape === "delete") return null;
  return typeof before === "string" ? applyEdit(before, step) : undefined;
}

// Steps one file's changes back from today's contents: each hunk is undone
// in turn, and every undo must find its context, so a file changed since the
// session stops the walk instead of giving a wrong earlier version.
function stepBack(today: string | null | undefined, steps: Step[]) {
  const before = new Map<Step, string | null>();
  let state = today;
  for (let i = steps.length - 1; i >= 0 && state !== undefined; i--) {
    const st = steps[i];
    if (st.opaque) break;
    if (st.create) state = null;
    else if (st.original !== undefined) state = st.original;
    else if (st.hunks?.length) {
      const shape = hunkShape(st.hunks);
      if (shape === "create") state = null;
      else if (shape === "delete") state = hunkSide(st.hunks, "-");
      else if (typeof state === "string")
        state = applyHunks(state, invertHunks(st.hunks)) ?? undefined;
      else state = undefined;
    } else state = undefined;
    if (state !== undefined) before.set(st, state);
  }
  return before;
}

// A file's contents in the last commit before the session began, for files
// whose first change the transcript cannot place (undefined: no commit, or
// git cannot say). Uncommitted work at the time is invisible to it.
function gitAt(root: string, at: string) {
  let sha = "";
  try {
    sha = execFileSync(
      "git",
      ["-C", root, "rev-list", "-1", `--before=${at}`, "HEAD"],
      { stdio: ["ignore", "pipe", "ignore"] },
    )
      .toString()
      .trim();
  } catch {
    sha = "";
  }
  const cache = new Map<string, string | null | undefined>();
  return (rel: string): string | null | undefined => {
    if (!sha) return undefined;
    if (cache.has(rel)) return cache.get(rel);
    let v: string | null | undefined;
    try {
      const out = execFileSync("git", ["-C", root, "show", `${sha}:${rel}`], {
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 4 * MAX_FILE,
      });
      v = out.length <= MAX_FILE ? out.toString() : undefined;
    } catch {
      // not in that commit: the file did not exist yet
      v = null;
    }
    cache.set(rel, v);
    return v;
  };
}

// ---------------------------------------------------------------- analysis

// Bash that may write into the tree: in-place edits, moves, deletes, package
// installs, git commands that rewrite files, formatters, and redirects.
const WRITES =
  /(?:^|[\s;&|(])(?:sed\s+(?:-\w+\s+)*-i|perl\s+-\w*i|tee\s|mv\s|cp\s|rm\s|touch\s|patch\s|git\s+(?:checkout|reset|restore|apply|stash|merge|rebase|pull|cherry-pick|revert|switch|am)\b|(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|remove|rm|uninstall|update|up|upgrade|init)\b|prettier\s[^|;&]*--write|eslint\s[^|;&]*--fix)/;
// a ">" that is not part of 2>&1, =>, -> or a comparison
const REDIRECT = /(?<![0-9&=\-<>])>{1,2}(?![&=])\s*["']?([^\s;&|"'<>()]+)/g;

function writesInto(command: string, root: string): boolean {
  const cmd = command.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, "");
  if (WRITES.test(cmd)) return true;
  for (const m of cmd.matchAll(REDIRECT)) {
    const t = m[1];
    if (t === "/dev/null") continue;
    if (!path.isAbsolute(t) || !path.relative(root, t).startsWith(".."))
      return true;
  }
  return false;
}

type Touch = {
  rel: string;
  readable: boolean;
  rebuilt: boolean;
  // why it was not: a reason per gap
  why: Set<string>;
};

type Sources = Record<
  | "original"
  | "chain"
  | "created"
  | "stepBack"
  | "git"
  | "today"
  | "unknown"
  | "applyFailed"
  | "opaque",
  number
>;

type Result = {
  session: Session;
  root: string;
  turns: number;
  touched: Touch[];
  outside: number;
  statements: Statement[];
  partial: number;
  turnsWithEdits: number;
  turnsWithStatements: number;
  unseenWrites: number;
  assumedClean: number;
  bashDiffs: number;
  bashGaps: Map<string, number>;
  drift: number;
  agree: [number, number];
  sources: Sources;
  verdict: Verdict;
};

function analyse(s: Session, root: string): Result {
  const base = baseline(root);
  const relOf = (abs: string) => {
    const r = path.relative(root, abs);
    return r.startsWith("..") || path.isAbsolute(r)
      ? null
      : r.split(path.sep).join("/");
  };
  const turnOf = (at: string) => {
    let lo = 0;
    let hi = s.prompts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s.prompts[mid] <= at) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const steps = new Map<string, Step[]>();
  const outside = new Set<string>();
  for (const e of s.events) {
    if (e.type !== "step") continue;
    const r = relOf(e.abs);
    if (r === null) outside.add(e.abs);
    else steps.set(r, [...(steps.get(r) ?? []), e]);
  }
  const ctx: Context = {
    aliases: base.aliases,
    exists: (r) => base.files.has(r) || steps.has(r),
  };
  const facts = (rel: string, text: string | null): Fact[] | null =>
    text === null ? [] : extract(rel, text, ctx);
  const back = new Map<Step, string | null>();
  for (const [rel, list] of steps)
    if (fileKind(rel))
      for (const [st, v] of stepBack(readDisk(root, rel), list))
        back.set(st, v);

  const atStart = gitAt(
    root,
    [s.events[0]?.at, s.prompts[0]].filter((x) => x).sort()[0] ?? "",
  );

  // the world at the start: today's tree for files the session never touched
  const world = new World();
  const untouched = new World();
  for (const [rel, f] of base.facts)
    if (!steps.has(rel)) {
      world.set(rel, f);
      untouched.set(rel, f);
    }

  const touched = new Map<string, Touch>();
  const touch = (rel: string) => {
    let t = touched.get(rel);
    if (!t) {
      const readable = !!fileKind(rel);
      touched.set(
        rel,
        (t = { rel, readable, rebuilt: readable, why: new Set() }),
      );
    }
    return t;
  };
  // known contents of touched files (null: does not exist); absent = unknown
  const cur = new Map<string, string | null>();
  // facts at each file's first known state, for the net diff
  const first = new Map<string, Fact[]>();
  const modified = new Set<string>();
  const calls: Statement[] = [];
  const partials: Statement[] = [];
  const sources: Sources = {
    original: 0,
    chain: 0,
    created: 0,
    stepBack: 0,
    git: 0,
    today: 0,
    unknown: 0,
    applyFailed: 0,
    opaque: 0,
  };
  let drift = 0;
  const agree: [number, number] = [0, 0];

  let turn = -1;
  let turnStart = new Map<string, Fact[]>();
  let turnEdited = false;
  let turnPartial = false;
  let turnsWithEdits = 0;
  let turnsWithStatements = 0;
  const closeTurn = () => {
    if (turnEdited) turnsWithEdits++;
    const changes = [...turnStart].map(([file, before]) => ({
      file,
      before,
      after: world.facts.get(file) ?? [],
    }));
    if (turnPartial || diffIn(world, changes).length) turnsWithStatements++;
    turnStart = new Map();
    turnEdited = false;
    turnPartial = false;
  };

  const known = (rel: string, text: string | null) => {
    cur.set(rel, text);
    const f = facts(rel, text);
    if (f) {
      world.set(rel, f);
      if (!first.has(rel)) first.set(rel, f);
    }
  };

  let unseenWrites = 0;
  let assumedClean = 0;
  let bashDiffs = 0;
  const bashGaps = new Map<string, number>();
  const tracking = s.events.some((e) => e.type === "bash" && e.tracked);

  for (const e of s.events) {
    const tn = turnOf(e.at);
    if (tn !== turn) {
      if (turn >= 0) closeTurn();
      turn = tn;
    }
    if (e.type === "bash") {
      if (e.tracked) bashDiffs++;
      for (const f of e.flags) bashGaps.set(f, (bashGaps.get(f) ?? 0) + 1);
      if (!e.tracked && e.command && writesInto(e.command, root)) {
        if (tracking) assumedClean++;
        else unseenWrites++;
      }
      continue;
    }
    const rel = relOf(e.abs);
    if (rel === null || !steps.has(rel)) continue;
    if (e.type === "seen") {
      const content =
        e.from === "read"
          ? e.content
          : e.backup === null
            ? null
            : readBackup(s.id, e.backup ?? "");
      if (content === undefined) continue;
      if (cur.has(rel) && cur.get(rel) !== content) drift++;
      if (cur.get(rel) !== content) known(rel, content);
      continue;
    }

    // a change
    const t = touch(rel);
    turnEdited = true;
    if (!t.readable) continue;
    if (!turnStart.has(rel)) turnStart.set(rel, world.facts.get(rel) ?? []);
    let before: string | null | undefined;
    if (e.original !== undefined) {
      if (cur.has(rel)) {
        agree[1]++;
        if (cur.get(rel) === e.original) agree[0]++;
      }
      before = e.original;
      sources.original++;
    } else if (cur.has(rel)) {
      before = cur.get(rel);
      sources.chain++;
    } else if (e.create || (e.hunks && hunkShape(e.hunks) === "create")) {
      before = null;
      sources.created++;
    } else if (back.has(e)) {
      before = back.get(e);
      sources.stepBack++;
    } else if (!modified.has(rel) && atStart(rel) !== undefined) {
      before = atStart(rel);
      sources.git++;
    } else if (e.opaque) sources.opaque++;
    else sources.unknown++;
    modified.add(rel);
    let after = forward(e, before);
    if (before !== undefined && after === undefined && e.hunks?.length)
      sources.applyFailed++;
    // a file Bash changed without a diff, and nothing changed after: take
    // today's contents as its end state, marked as inferred
    let inferred = false;
    if (after === undefined && e.opaque && steps.get(rel)?.at(-1) === e) {
      after = readDisk(root, rel);
      inferred = after !== undefined;
      if (inferred) sources.today++;
    }
    const ev = { turn: tn, toolUseId: e.id, tool: e.tool };
    if (before !== undefined && !first.has(rel)) {
      const bf = facts(rel, before);
      if (bf) first.set(rel, bf);
    }

    if (before === undefined || after === undefined) {
      t.rebuilt = false;
      t.why.add(
        e.opaque
          ? "Bash kept no diff"
          : before === undefined
            ? "no before state"
            : "edit would not apply",
      );
      const h = e.hunks?.length ? hunkFacts(rel, e.hunks, ctx) : null;
      if (h) {
        const st = attach(
          diffIn(world, [{ file: rel, before: h.before, after: h.after }]),
          { ...ev, partial: true },
        );
        if (st.length) turnPartial = true;
        partials.push(...st);
        calls.push(...st);
      }
      if (after !== undefined) known(rel, after);
      else cur.delete(rel);
      continue;
    }
    const bf = facts(rel, before);
    const af = facts(rel, after);
    if (bf === null || af === null) t.why.add("could not parse");
    if (inferred) t.why.add("end state from today's file");
    if (bf === null || af === null || inferred) t.rebuilt = false;
    calls.push(
      ...attach(
        diffIn(world, [{ file: rel, before: bf ?? [], after: af ?? [] }]),
        inferred ? { ...ev, partial: true } : ev,
      ),
    );
    cur.set(rel, after);
    if (af) world.set(rel, af);
  }
  if (turn >= 0) closeTurn();

  // net: each changed file from its first known state to its last
  const changes: Change[] = [];
  // a file whose end state is unknown has no net change; what its calls
  // showed is kept, marked as partly inferred
  const lost = new Set(
    [...touched.values()]
      .filter((t) => t.readable && !cur.has(t.rel))
      .map((t) => t.rel),
  );
  for (const c of calls)
    if (!c.evidence.some((e) => e.partial) && c.files.every((f) => lost.has(f)))
      partials.push({
        ...c,
        evidence: c.evidence.map((e) => ({ ...e, partial: true })),
      });
  for (const t of touched.values())
    if (t.readable && first.has(t.rel) && !lost.has(t.rel))
      changes.push({
        file: t.rel,
        before: first.get(t.rel) ?? [],
        after: world.facts.get(t.rel) ?? [],
      });
  const net = explain(diffIn(untouched, changes), calls);
  // a net change no single call explains (its states came from Reads or
  // backups) is pinned to the calls that changed the file
  for (const st of net)
    if (!st.evidence.some((e) => e.toolUseId))
      st.evidence = st.files.flatMap((f) =>
        (steps.get(f) ?? []).map((x) => ({
          file: f,
          turn: turnOf(x.at),
          toolUseId: x.id,
          tool: x.tool,
        })),
      );
  const netKeys = new Set(net.map(kk));
  for (const p of netPartials(partials))
    if (!netKeys.has(kk(p))) net.push({ ...p, evidence: p.evidence });
  for (const st of net)
    if (st.evidence.length && st.evidence.every((e) => e.partial))
      st.text += " (partly inferred)";

  const files: ChangedFile[] = [...touched.values()].map((t) => ({
    path: t.rel,
    readable: t.readable,
    reconstructed: t.rebuilt,
  }));
  return {
    session: s,
    root,
    turns: s.prompts.length,
    touched: [...touched.values()],
    outside: outside.size,
    statements: net,
    partial: partials.length,
    turnsWithEdits,
    turnsWithStatements,
    unseenWrites,
    assumedClean,
    bashDiffs,
    bashGaps,
    drift,
    agree,
    sources,
    verdict: noStructuralChange(net, files, unseenWrites),
  };
}

// Statements read from hunks only, netted per fact: added then removed in a
// later call is no change; the last value of a changed one stands.
function netPartials(partials: Statement[]): Statement[] {
  const by = new Map<
    string,
    { score: number; last: Statement; ev: Evidence[] }
  >();
  for (const p of partials) {
    const k = kk(p);
    const e = by.get(k) ?? { score: 0, last: p, ev: [] };
    e.score += p.op === "added" ? 1 : p.op === "removed" ? -1 : 0;
    e.last = p;
    e.ev.push(...p.evidence);
    by.set(k, e);
  }
  const out: Statement[] = [];
  for (const { score, last, ev } of by.values()) {
    if (last.op === "changed") out.push({ ...last, evidence: ev });
    else if (score !== 0) {
      const op = score > 0 ? "added" : "removed";
      const text = op === last.op ? last.text : last.text.replace(/^\w+/, op);
      out.push({ ...last, op, text, evidence: ev });
    }
  }
  return out;
}

// ---------------------------------------------------------------- report

function kindLabel(rel: string): string {
  const k = fileKind(rel);
  if (k === "source") return "TS/JS source";
  if (k === "manifest") return "package.json";
  if (k === "compose") return "compose";
  return extensionOf(rel);
}

function counts<T>(xs: T[]): [T, number][] {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

const fmtCounts = (xs: [string, number][]) =>
  xs.map(([k, n]) => `${k} ${n}`).join(", ");

function evidenceLine(ev: Evidence[]): string {
  const shown = ev.slice(0, 3).map((e) => {
    const bits = [e.file];
    if (e.turn !== undefined) bits.push(`turn ${e.turn}`);
    if (e.toolUseId) bits.push(`${e.toolUseId}${e.tool ? ` (${e.tool})` : ""}`);
    return bits.join(" · ");
  });
  return shown.join("; ") + (ev.length > 3 ? `; +${ev.length - 3} more` : "");
}

const pct = (a: number, b: number) =>
  b ? `${Math.round((100 * a) / b)}%` : "-";

const TEST_FILE =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests?|e2e)\/)/;
const onlyTests = (s: Statement) =>
  s.files.length > 0 && s.files.every((f) => TEST_FILE.test(f));
const builtin = (s: Statement) =>
  s.kind === "import-edge" && / → node:/.test(s.key);

const list = (paths: string[], max: number) =>
  paths
    .slice(0, max)
    .map((p) => `\`${p}\``)
    .join(", ") + (paths.length > max ? `, +${paths.length - max} more` : "");

function report(results: Result[], scanned: number, skipped: number): string {
  const all = results.flatMap((r) => r.statements);
  const perSession = results.map((r) => r.statements.length);
  const sorted = [...perSession].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const bucket = (n: number) =>
    n === 0 ? "0" : n <= 2 ? "1–2" : n <= 5 ? "3–5" : n <= 10 ? "6–10" : ">10";
  const buckets = ["0", "1–2", "3–5", "6–10", ">10"].map(
    (b) => `${b}: ${perSession.filter((n) => bucket(n) === b).length}`,
  );
  const files = results.flatMap((r) => r.touched);
  const unreadable = files.filter((f) => !f.readable);
  const readable = files.filter((f) => f.readable);
  const gaps = readable.filter((f) => !f.rebuilt);
  const withEdits = results.filter((r) => r.touched.length);
  const zero = results.filter((r) => !r.statements.length);
  const allowed = zero.filter((r) => r.verdict.allowed);
  const blocked = zero.filter((r) => !r.verdict.allowed);
  const core = results.filter((r) =>
    r.statements.some((s) => !onlyTests(s) && !builtin(s)),
  );
  const sum = (k: (r: Result) => number) =>
    results.reduce((a, r) => a + k(r), 0);
  const src = (k: keyof Sources) => sum((r) => r.sources[k]);
  const steps =
    src("original") +
    src("chain") +
    src("created") +
    src("stepBack") +
    src("git") +
    src("unknown") +
    src("opaque");
  const gapsBy = new Map<string, number>();
  for (const r of results)
    for (const [k, n] of r.bashGaps) gapsBy.set(k, (gapsBy.get(k) ?? 0) + n);
  const fileResults = sum((r) => r.session.stats.fileResults);
  const nullOriginal = sum((r) => r.session.stats.nullOriginal);

  const L: string[] = [];
  L.push("# 9. What changed: a retro on past sessions");
  L.push("");
  L.push(
    `Rebuilt from the ${results.length} most recent Claude Code transcripts whose working folder is inside a git work tree (${scanned} scanned, ${skipped} skipped as outside any work tree). No model calls. Extractors (version 1): TS/JS imports folded to two directory levels, package.json, docker-compose. Statements are the session's net change (first known state → last), each with the tool calls that made it; one marked *(partly inferred)* rests on diff hunks without the whole file, on today's file standing in for an end state Bash left without a diff, or on a file whose end state is unknown. Made by \`app/eval/changes-retro.ts\`; paths and statement lines only.`,
  );
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push(
    `- **Sessions with at least one structural statement: ${results.length - zero.length} of ${results.length}** (${withEdits.length} changed any file in their work tree). Leaving out statements that come only from test files or are Node builtins: ${core.length} of ${results.length}.`,
  );
  L.push(
    `- Statements per session: ${buckets.join(" · ")} (median ${median}, max ${sorted.at(-1) ?? 0}, total ${all.length}; ${all.filter(onlyTests).length} only from test files, ${all.filter(builtin).length} Node builtins, ${all.filter((s) => s.evidence.length && s.evidence.every((e) => e.partial)).length} partly inferred).`,
  );
  L.push(
    `- By kind: ${fmtCounts(counts(all.map((s) => `${s.op} ${s.kind}`))) || "none"}.`,
  );
  L.push(
    `- Turns: ${sum((r) => r.turnsWithStatements)} of the ${sum((r) => r.turnsWithEdits)} turns that changed files had a structural statement (${sum((r) => r.turns)} turns in all).`,
  );
  L.push(
    `- Changed files in work trees: ${files.length}. **Of kinds no extractor reads: ${unreadable.length} (${pct(unreadable.length, files.length)})**. Of the ${readable.length} readable ones, ${gaps.length} (${pct(gaps.length, readable.length)}) could not be rebuilt in full (${fmtCounts(counts(gaps.flatMap((t) => [...t.why])))}). Unreadable kinds: ${fmtCounts(counts(unreadable.map((f) => extensionOf(f.rel))).slice(0, 12))}.`,
  );
  L.push(
    `- "No structural change" could truthfully be said in ${allowed.length} of the ${zero.length} sessions with no statement${allowed.length ? ` (${allowed.filter((r) => !r.touched.length).length} of them changed no file)` : ""}. In the other ${blocked.length}: unreadable kinds changed in ${blocked.filter((r) => r.touched.some((t) => !t.readable)).length}, readable files not rebuilt in ${blocked.filter((r) => r.touched.some((t) => t.readable && !t.rebuilt)).length}, unseen Bash writes in ${blocked.filter((r) => r.unseenWrites).length}.`,
  );
  L.push("");
  L.push("### What could and could not be rebuilt");
  L.push("");
  L.push(
    `- Edit/Write results: ${fileResults}; ${nullOriginal} (${pct(nullOriginal, fileResults)}) had no \`originalFile\`.`,
  );
  L.push(
    `- Where each change's "before" came from (${steps} changes to readable files): \`originalFile\` ${src("original")}, the previous call, a full Read or a file-history backup ${src("chain")}, a new file ${src("created")}, stepped back from today's file by undoing later hunks ${src("stepBack")}, the last commit before the session ${src("git")}, unknown ${src("unknown")}, Bash changed it with no diff kept ${src("opaque")} (today's contents stood in as the end state of ${src("today")} files whose last change was such a write). A known "before" whose edit would not apply: ${src("applyFailed")}.`,
  );
  L.push(
    `- Cross-check: where a rebuilt state met an \`originalFile\`, they matched ${sum((r) => r.agree[0])} of ${sum((r) => r.agree[1])} times. A Read or backup disagreed with the rebuilt state ${sum((r) => r.drift)} times (a change the transcript does not show: you, another session, or an untracked Bash write).`,
  );
  L.push(
    `- Bash results with \`bashEditDiff\`: ${sum((r) => r.bashDiffs)}; gaps: ${fmtCounts([...gapsBy]) || "none"} (\`shared\`/\`unavailable\`: no diff at all; \`moreFiles\`: more files changed than listed).`,
  );
  L.push(
    `- Bash commands that look like writes into the tree and carry no \`bashEditDiff\`: ${sum((r) => r.unseenWrites)} in sessions with no diff tracking (counted against "No structural change"), ${sum((r) => r.assumedClean)} in sessions where tracking was on (taken as having changed no tracked file).`,
  );
  L.push(
    "- Not reconstructable: Bash writes with no diff (redirects, `sed -i`, `npm install` without tracking, `shared`/`unavailable` results), edits made outside Claude Code, git-ignored files Bash changed, and files outside the work tree (counted, never read). Files a session never touched are read from today's tree, so an edge another file held then but not now can be misjudged.",
  );
  L.push("");
  L.push("## Sessions");
  let n = 0;
  const numbered: string[] = [];
  for (const [i, r] of results.entries()) {
    const s = r.session;
    const name = `${path.basename(r.root)} · ${s.id.slice(0, 8)}`;
    L.push("");
    L.push(
      `### ${i + 1}. ${name} · ${new Date(s.mtime).toISOString().slice(0, 10)} · ${r.turns} turns`,
    );
    L.push("");
    const byKind = counts(r.touched.map((t) => kindLabel(t.rel)));
    L.push(
      `- Files changed: ${r.touched.length}${byKind.length ? ` (${fmtCounts(byKind)})` : ""}${r.outside ? `; ${r.outside} outside the work tree, not read` : ""}.`,
    );
    if (r.statements.length) {
      L.push(
        `- Structural statements: ${r.statements.length} (${r.turnsWithStatements} of ${r.turnsWithEdits} turns with edits had one):`,
      );
      for (const st of r.statements) {
        n++;
        L.push(`  - [#${n}] ${st.text} — ${evidenceLine(st.evidence)}`);
        numbered.push(
          `${n}. [ ] worth confirming · [ ] noise — ${name}: ${st.text}`,
        );
      }
    } else L.push("- Structural statements: none.");
    const cant = r.touched.filter((t) => !t.readable).map((t) => t.rel);
    if (cant.length)
      L.push(
        `- Changed files the map can't read (${cant.length}): ${list(cant, 12)}.`,
      );
    const notRebuilt = r.touched.filter((t) => t.readable && !t.rebuilt);
    if (notRebuilt.length)
      L.push(
        `- Readable but not rebuilt in full (${notRebuilt.length}; ${fmtCounts(counts(notRebuilt.flatMap((t) => [...t.why])))}): ${list(
          notRebuilt.map((t) => t.rel),
          8,
        )}.`,
      );
    if (r.unseenWrites)
      L.push(
        `- Bash commands that may have written files with no diff: ${r.unseenWrites}.`,
      );
    L.push(
      `- "No structural change": ${r.verdict.allowed ? `**can be said** (${r.verdict.reason})` : `can't be said: ${r.verdict.reason}`}.`,
    );
  }
  L.push("");
  L.push("## All statements, to mark");
  L.push("");
  L.push(numbered.length ? numbered.join("\n") : "None.");
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------- main

async function main() {
  const transcripts: { file: string; mtime: number }[] = [];
  for (const dir of fs.readdirSync(PROJECTS)) {
    const d = path.join(PROJECTS, dir);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d))
      if (f.endsWith(".jsonl")) {
        const file = path.join(d, f);
        transcripts.push({ file, mtime: fs.statSync(file).mtimeMs });
      }
  }
  transcripts.sort((a, b) => b.mtime - a.mtime);
  const results: Result[] = [];
  let scanned = 0;
  let skipped = 0;
  for (const t of transcripts) {
    if (results.length >= N) break;
    scanned++;
    const s = await readSession(t.file);
    // the most used working folder that is inside a git work tree
    const cwd = [...s.cwds]
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c)
      .find((c) => repoRoot(c));
    const root = cwd ? repoRoot(cwd) : null;
    if (!root) {
      skipped++;
      continue;
    }
    const r = analyse(s, root);
    results.push(r);
    console.log(
      `${results.length}/${N} ${path.basename(root)} ${s.id.slice(0, 8)}: ${r.touched.length} files, ${r.statements.length} statements`,
    );
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, report(results, scanned, skipped));
  console.log(`→ ${OUT}`);
}

await main();
