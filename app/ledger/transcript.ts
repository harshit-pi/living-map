// A Claude Code transcript (`~/.claude/projects/<project>/<session>.jsonl`)
// read into entries, the active path and turns. Reading is incremental by
// byte offset, in bounded chunks, whole lines only: the last line may still
// be being written. Everything after reading is a pure function of what was
// read, so a replay from the same bytes gives the same turns.
//
// What is kept of each entry: its ids and links, its kind, its time, the
// words (what you typed, Claude's text) and, for edits, the patch. Tool
// output is never kept.
//
// How a line becomes a prompt:
// - typed: a user entry with your text. Tool results, compaction summaries,
//   `isMeta` entries (skill expansions, image notes), interruptions, local
//   command output and anything the app sent in your place (task
//   notifications, agent messages: `origin.kind` other than "human") are not.
// - queued: what you typed while Claude worked arrives as an `attachment`
//   of type `queued_command`. It counts when `commandMode` is "prompt" and
//   its origin is you; task notifications ("task-notification") and agent
//   messages (`origin.kind` "peer", marked `isMeta`) do not.
// - command: a slash command counts when Claude is asked to act on it: a
//   skill or custom command, marked as yours or followed by its expansion.
//   A built-in that runs locally (/model, /compact) is followed by its own
//   output and is not a prompt.
// - `!` shell input runs in your terminal, not as a request: kept, not a prompt.
// - Hook context is its own `hook_additional_context` attachment line:
//   flagged on its turn, never a prompt.

import { open } from "node:fs/promises";

// a transcript line: untrusted JSON, read field by field
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

// a turn the file says Claude finished is sealed once nothing has been
// written for this long (the next prompt seals it at once)
export const SEAL_IDLE_MS = 5000;

const CHUNK = 1 << 20;

export type Kind =
  | "prompt" // you typed it
  | "queued" // you typed it while Claude worked
  | "command" // a slash command (a prompt once resolved, see `isPrompt`)
  | "shell" // `!` input run in your terminal
  | "assistant"
  | "tool_result"
  | "notice" // sent in your place: task notifications, agent messages
  | "meta" // expansions and notes the app adds
  | "summary" // a compaction's summary
  | "interrupt"
  | "local" // a local command's output
  | "hook" // hook context
  | "edited" // a file changed outside Claude's tools
  | "compact" // a compaction boundary
  | "attachment"
  | "system";

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

// what a tool call changed, from the entry's top-level `toolUseResult`
export interface ToolChange {
  toolUseId: string;
  entry: string;
  tool?: string;
  filePath?: string;
  structuredPatch?: Hunk[];
  originalFile?: string | null;
  // a created file has no patch: what was written is the change
  content?: string;
  bashEditDiff?: { files: { filePath: string; hunks: Hunk[] }[] };
}

export interface Entry {
  uuid: string;
  // its place among the kept entries, in file order
  seq: number;
  parent: string | null;
  logicalParent: string | null;
  type: string;
  kind: Kind;
  ts: number;
  text?: string;
  origin?: string;
  stop?: string;
  hookEvent?: string;
  filePath?: string;
  change?: ToolChange;
  // calls to Claude's own task list, in order (see tasks.ts): kept whole,
  // as they are small and say what Claude is on with no model
  plan?: { tool: string; input: unknown }[];
}

export interface Transcript {
  offset: number;
  entries: Entry[];
  byId: Map<string, Entry>;
  // tool_use id → tool name, to name what a result came from
  tools: Map<string, string>;
  lines: number;
  bad: number;
  duplicates: number;
  sidechain: number;
}

export interface Turn {
  n: number;
  prompt: string;
  via: "typed" | "queued" | "command";
  text: string;
  ts: number;
  end: number;
  reply: string;
  entries: string[];
  changes: ToolChange[];
  hooks: string[];
}

export interface View {
  path: Entry[];
  abandoned: Entry[];
  turns: Turn[];
  // changes before the first prompt belong to turn 0
  changes: (ToolChange & { turn: number })[];
  sealed: number;
  compactions: number;
}

export const emptyTranscript = (): Transcript => ({
  offset: 0,
  entries: [],
  byId: new Map(),
  tools: new Map(),
  lines: 0,
  bad: 0,
  duplicates: 0,
  sidechain: 0,
});

// ---- reading ------------------------------------------------------------------

// Reads what was appended since `t.offset`, a chunk at a time; a line longer
// than a chunk is gathered across chunks. A file shorter than what was read
// was replaced: it is read again from the start.
export async function readMore(
  t: Transcript,
  path: string,
  chunk = CHUNK,
): Promise<{ added: number; reset: boolean }> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    let reset = false;
    if (size < t.offset) {
      Object.assign(t, emptyTranscript());
      reset = true;
    }
    const before = t.entries.length;
    const buf = Buffer.alloc(chunk);
    let carry: Buffer = Buffer.alloc(0);
    let pos = t.offset;
    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, chunk, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const data = carry.length
        ? Buffer.concat([carry, buf.subarray(0, bytesRead)])
        : buf.subarray(0, bytesRead);
      const end = data.lastIndexOf(10);
      if (end < 0) {
        carry = Buffer.from(data);
        continue;
      }
      ingest(t, data.subarray(0, end + 1).toString("utf8"));
      t.offset += end + 1;
      carry = Buffer.from(data.subarray(end + 1));
    }
    return { added: t.entries.length - before, reset };
  } finally {
    await fh.close();
  }
}

// Whole lines in; each uuid is kept once (the first copy wins: resumed and
// compacted chats write earlier entries again).
export function ingest(t: Transcript, text: string): void {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    t.lines++;
    let d: Raw;
    try {
      d = JSON.parse(line);
    } catch {
      t.bad++;
      continue;
    }
    if (!d || typeof d !== "object" || typeof d.uuid !== "string") continue;
    if (t.byId.has(d.uuid)) {
      t.duplicates++;
      continue;
    }
    if (d.isSidechain === true) {
      t.sidechain++;
      continue;
    }
    const e = toEntry(d, t.tools, t.entries.length);
    t.byId.set(e.uuid, e);
    t.entries.push(e);
  }
}

// ---- one entry ------------------------------------------------------------------

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const blocks = (content: unknown): Raw[] =>
  Array.isArray(content)
    ? content.filter((b) => b && typeof b === "object")
    : [];

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : blocks(content)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n");

const NOTICE =
  /^\s*(<task-notification[\s>]|<agent-message[\s>]|<[a-z-]+-event[\s>]|Another Claude session sent a message)/;
const LOCAL = /^\s*<(local-command-[a-z]+|bash-stdout|bash-stderr)>/;
const INTERRUPT = /^\[Request interrupted by user/;

const clean = (s: string) =>
  s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const tag = (s: string, name: string) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s)?.[1]?.trim() ?? "";

// what you wrote, and what kind of user line it is
function userKind(d: Raw): { kind: Kind; text?: string } {
  const content = d.message?.content;
  if (d.isCompactSummary === true) return { kind: "summary" };
  if (blocks(content).some((b) => b.type === "tool_result"))
    return { kind: "tool_result" };
  const origin = str(d.origin?.kind);
  if (origin && origin !== "human") return { kind: "notice" };
  if (d.isMeta === true) return { kind: "meta" };
  const t = clean(textOf(content));
  if (!t) return { kind: "meta" };
  if (INTERRUPT.test(t)) return { kind: "interrupt" };
  if (NOTICE.test(t)) return { kind: "notice" };
  if (t.includes("<bash-input>"))
    return { kind: "shell", text: tag(t, "bash-input") };
  if (LOCAL.test(t)) return { kind: "local" };
  if (t.includes("<command-name>")) {
    const text = `${tag(t, "command-name")} ${tag(t, "command-args")}`;
    return { kind: "command", text: text.trim() };
  }
  return { kind: "prompt", text: t };
}

function queued(a: Raw): { kind: Kind; text?: string } {
  const prompt = a.prompt;
  const text = clean(typeof prompt === "string" ? prompt : textOf(prompt));
  const origin = str(a.origin?.kind);
  const yours =
    a.commandMode === "prompt" &&
    a.isMeta !== true &&
    (origin ? origin === "human" : !NOTICE.test(text));
  return yours && text ? { kind: "queued", text } : { kind: "notice" };
}

function toolChange(d: Raw, entry: string, tools: Map<string, string>) {
  const r = d.toolUseResult;
  if (!r || typeof r !== "object" || Array.isArray(r)) return undefined;
  const patch = Array.isArray(r.structuredPatch);
  const bash = r.bashEditDiff && typeof r.bashEditDiff === "object";
  if (!patch && !bash) return undefined;
  const id = str(
    blocks(d.message?.content).find((b) => b.type === "tool_result")
      ?.tool_use_id,
  );
  if (!id) return undefined;
  const c: ToolChange = { toolUseId: id, entry };
  const tool = tools.get(id);
  if (tool) c.tool = tool;
  if (typeof r.filePath === "string") c.filePath = r.filePath;
  if (patch) c.structuredPatch = r.structuredPatch;
  if (typeof r.originalFile === "string" || r.originalFile === null)
    c.originalFile = r.originalFile;
  if (r.type === "create" && typeof r.content === "string")
    c.content = r.content;
  if (bash) c.bashEditDiff = r.bashEditDiff;
  return c;
}

// the tools that hold Claude's task list: the desktop app's plan (and its
// wrap-up, which ticks it off), TodoWrite, and the Task tools
export const PLAN_TOOL =
  /(?:^|__)(?:update_plan|wrap_up)$|^TodoWrite$|^Task(?:Create|Update)$/;

export function toEntry(
  d: Raw,
  tools = new Map<string, string>(),
  seq = 0,
): Entry {
  const e: Entry = {
    uuid: d.uuid,
    seq,
    parent: str(d.parentUuid) ?? null,
    logicalParent: str(d.logicalParentUuid) ?? null,
    type: str(d.type) ?? "",
    kind: "system",
    ts: Date.parse(str(d.timestamp) ?? "") || 0,
  };
  const origin = str(d.origin?.kind);
  if (origin) e.origin = origin;
  if (e.type === "user") {
    const { kind, text } = userKind(d);
    e.kind = kind;
    if (text) e.text = text;
    const change = toolChange(d, e.uuid, tools);
    if (change) e.change = change;
  } else if (e.type === "assistant") {
    e.kind = "assistant";
    const content = d.message?.content;
    for (const b of blocks(content))
      if (b.type === "tool_use" && typeof b.id === "string") {
        const name = str(b.name) ?? "";
        tools.set(b.id, name);
        if (PLAN_TOOL.test(name))
          (e.plan ??= []).push({ tool: name, input: b.input });
      }
    const text = textOf(content).trim();
    if (text) e.text = text;
    const stop = str(d.message?.stop_reason);
    if (stop) e.stop = stop;
  } else if (e.type === "attachment") {
    const a = d.attachment ?? {};
    const type = str(a.type);
    if (type === "queued_command") {
      const q = queued(a);
      e.kind = q.kind;
      if (q.text) e.text = q.text;
      const o = str(a.origin?.kind);
      if (o) e.origin = o;
    } else if (type === "hook_additional_context") {
      e.kind = "hook";
      const event = str(a.hookEvent);
      if (event) e.hookEvent = event;
      const c = a.content;
      const text = Array.isArray(c)
        ? c.filter((x) => typeof x === "string").join("\n")
        : str(c);
      if (text) e.text = text;
    } else if (type === "edited_text_file") {
      e.kind = "edited";
      const f = str(a.filename);
      if (f) e.filePath = f;
    } else e.kind = "attachment";
  } else if (e.type === "system" && d.subtype === "compact_boundary") {
    e.kind = "compact";
  }
  return e;
}

// ---- the active path ------------------------------------------------------------

// The entry an entry follows. A compaction boundary has no parent but names
// the entry it continues (`logicalParentUuid`): a compaction is not a new
// root. A link to an entry the file never wrote (an auto-compaction names
// the message it interrupted) continues from the entry written just before.
export function above(t: Transcript, e: Entry): Entry | undefined {
  const up = e.parent ?? e.logicalParent;
  if (!up) return undefined;
  return t.byId.get(up) ?? (e.seq > 0 ? t.entries[e.seq - 1] : undefined);
}

// From the newest entry back to the root.
export function activePath(t: Transcript): Entry[] {
  const path: Entry[] = [];
  const on = new Set<string>();
  let e: Entry | undefined = t.entries[t.entries.length - 1];
  while (e && !on.has(e.uuid)) {
    path.push(e);
    on.add(e.uuid);
    e = above(t, e);
  }
  return path.reverse();
}

// A slash command is a prompt when it is yours, or when what follows it on
// the path is not a local command's output. One just typed (nothing after it
// yet) waits for the next line to tell.
export function isPrompt(path: Entry[], i: number): boolean {
  const e = path[i];
  if (e.kind === "prompt" || e.kind === "queued") return true;
  if (e.kind !== "command") return false;
  if (e.origin === "human") return true;
  const next = path[i + 1];
  return !!next && next.kind !== "local";
}

const ASKS: Kind[] = ["prompt", "queued", "command"];

// Entries off the path, by the path entry they hang from. Claude Code links
// each result of parallel tool calls to the block that made the call, so a
// branch without a prompt is a side branch of one step: it stays in its
// turn. A branch holding a prompt was left by a rewind (or by a second
// writer), and so is a branch that never reaches the path.
export function branches(
  t: Transcript,
  path: Entry[],
): { side: Map<string, Entry[]>; abandoned: Entry[] } {
  const on = new Set(path.map((e) => e.uuid));
  const top = new Map<string, string>();
  const hang = new Map<string, string | null>();
  const groups = new Map<string, Entry[]>();
  for (const e of t.entries) {
    if (on.has(e.uuid) || top.has(e.uuid)) continue;
    const chain: Entry[] = [];
    const seen = new Set<string>();
    let cur: Entry | undefined = e;
    while (
      cur &&
      !on.has(cur.uuid) &&
      !top.has(cur.uuid) &&
      !seen.has(cur.uuid)
    ) {
      chain.push(cur);
      seen.add(cur.uuid);
      cur = above(t, cur);
    }
    let head: string;
    if (cur && top.has(cur.uuid)) head = top.get(cur.uuid)!;
    else {
      head = chain[chain.length - 1].uuid;
      hang.set(head, cur && on.has(cur.uuid) ? cur.uuid : null);
    }
    for (const c of chain) top.set(c.uuid, head);
  }
  for (const e of t.entries) {
    const head = top.get(e.uuid);
    if (!head) continue;
    const g = groups.get(head) ?? [];
    g.push(e);
    groups.set(head, g);
  }
  const side = new Map<string, Entry[]>();
  const abandoned: Entry[] = [];
  for (const [head, g] of groups) {
    const at = hang.get(head);
    if (!at || g.some((e) => ASKS.includes(e.kind))) abandoned.push(...g);
    else side.set(at, [...(side.get(at) ?? []), ...g]);
  }
  abandoned.sort((a, b) => a.seq - b.seq);
  return { side, abandoned };
}

export function buildTurns(
  path: Entry[],
  side: Map<string, Entry[]> = new Map(),
): { turns: Turn[]; before: ToolChange[] } {
  const turns: Turn[] = [];
  const before: Entry[] = [];
  let cur: Turn | undefined;
  const add = (tn: Turn, e: Entry) => {
    tn.entries.push(e.uuid);
    if (e.ts) tn.end = Math.max(tn.end, e.ts);
    if (e.kind === "assistant" && e.text)
      tn.reply = tn.reply ? `${tn.reply}\n\n${e.text}` : e.text;
    if (e.kind === "hook") tn.hooks.push(e.uuid);
  };
  const changes = new Map<Turn | undefined, Entry[]>();
  const changed = (tn: Turn | undefined, e: Entry) => {
    if (e.change) changes.set(tn, [...(changes.get(tn) ?? []), e]);
  };
  path.forEach((e, i) => {
    if (isPrompt(path, i)) {
      cur = {
        n: turns.length + 1,
        prompt: e.uuid,
        via:
          e.kind === "queued"
            ? "queued"
            : e.kind === "command"
              ? "command"
              : "typed",
        text: e.text ?? "",
        ts: e.ts,
        end: e.ts,
        reply: "",
        entries: [e.uuid],
        changes: [],
        hooks: [],
      };
      turns.push(cur);
    } else if (cur) add(cur, e);
    else before.push(e);
    changed(cur, e);
    for (const s of side.get(e.uuid) ?? []) {
      if (cur) add(cur, s);
      changed(cur, s);
    }
  });
  // in the order they were written: a file's patches apply one after another
  const ordered = (es: Entry[] = []) =>
    es.sort((a, b) => a.seq - b.seq).map((e) => e.change!);
  for (const tn of turns) tn.changes = ordered(changes.get(tn));
  return { turns, before: ordered(changes.get(undefined)) };
}

// what says where the conversation is, not the bookkeeping written around
// it (hook summaries, attachments, a local command's output)
const SPOKEN: Kind[] = [
  "assistant",
  "tool_result",
  "notice",
  "interrupt",
  ...ASKS,
];

export function lastSpoken(path: Entry[]): Entry | undefined {
  for (let i = path.length - 1; i >= 0; i--)
    if (SPOKEN.includes(path[i].kind)) return path[i];
  return undefined;
}

// How many turns are sealed: every turn with a later prompt, and the last
// one too once it is over (Claude ended it, or you interrupted it) and the
// file has been quiet for `SEAL_IDLE_MS`.
export function sealedCount(
  turns: Turn[],
  last: Entry | undefined,
  idleMs: number,
): number {
  if (!turns.length) return 0;
  const over =
    (last?.kind === "assistant" && last.stop === "end_turn") ||
    last?.kind === "interrupt";
  return over && idleMs >= SEAL_IDLE_MS ? turns.length : turns.length - 1;
}

export function view(t: Transcript, idleMs: number): View {
  const path = activePath(t);
  const { side, abandoned } = branches(t, path);
  const { turns, before } = buildTurns(path, side);
  return {
    path,
    abandoned,
    turns,
    changes: [
      ...before.map((c) => ({ ...c, turn: 0 })),
      ...turns.flatMap((tn) => tn.changes.map((c) => ({ ...c, turn: tn.n }))),
    ],
    sealed: sealedCount(turns, lastSpoken(path), idleMs),
    compactions: t.entries.filter((e) => e.kind === "compact").length,
  };
}
