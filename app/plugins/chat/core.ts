// Chat's pure logic: reading a Claude Code transcript into turns, what each
// node on the map stands for, the map as the model reads it, when the map
// should catch up, and what the main conversation has not heard yet.

import {
  ITEM_TYPES,
  type Item,
  type ItemState,
  type ItemType,
  type Turn,
} from "./shared.ts";
import { subtree } from "../../server/core/canvas.ts";
import {
  own,
  safeId,
  type Raw,
  type StoredMap,
} from "../../server/core/types.ts";
import type { MapNode } from "../../shared/model.ts";

export const ROOT = "root";

// a turn longer than this is kept as its start: the map needs what it is
// about, not every line
const TURN_CHARS = 3000;
// what one catch-up move may send of new turns: a long conversation linked
// for the first time is sent in shorter pieces per turn
const DIGEST_CHARS = 40_000;
// each turn gets at least this much of it, so one catch-up takes at most
// DIGEST_CHARS / TURN_FLOOR turns and a long conversation is filed in several
const TURN_FLOOR = 300;
export const BATCH_TURNS = Math.floor(DIGEST_CHARS / TURN_FLOOR);
// the outbox keeps this many lines; older ones were long since read
const OUTBOX_KEEP = 40;

export type Outgoing = { ts: number; text: string };

export type ChatState = {
  items: Record<string, Item>;
  turns: Turn[];
  // where reading the transcript got to, and the entries already read (a
  // conversation can move to another file, which repeats them)
  file: string;
  offset: number;
  seen: string[];
  // turns the map has been brought up to, and those the catch-up under way
  // was sent
  mapped: number;
  upTo: number;
  // bumped when the map is drawn again: a catch-up started before it does
  // not move `mapped`
  gen: number;
  // a catch-up you stopped: the map waits for new turns before the next
  heldAt: number;
  following: boolean;
  syncedAt: number | null;
  // when the transcript last grew
  activeAt: number;
  summary: string;
  outbox: Outgoing[];
  sent: number; // outbox lines the main conversation has had
};

export const newState = (): ChatState => ({
  items: {},
  turns: [],
  file: "",
  offset: 0,
  seen: [],
  mapped: 0,
  upTo: 0,
  gen: 0,
  heldAt: 0,
  following: true,
  syncedAt: null,
  activeAt: 0,
  summary: "",
  outbox: [],
  sent: 0,
});

// ---- reading the transcript ---------------------------------------------------

// What you typed, without what the app wraps around it: reminders it adds,
// a terminal command's output, a skill's expansion. A command you ran or a
// skill you called stays, said plainly.
export function cleanUserText(raw: string): string {
  let t = raw;
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  t = t.replace(
    /<bash-input>([\s\S]*?)<\/bash-input>/g,
    (_, c: string) => `Ran in the terminal: ${c.trim()}\n`,
  );
  t = t.replace(/<bash-(stdout|stderr)>[\s\S]*?<\/bash-\1>/g, "");
  t = t.replace(/<command-message>[\s\S]*?<\/command-message>/g, "");
  t = t.replace(
    /<command-name>([\s\S]*?)<\/command-name>/g,
    (_, c: string) => `${c.trim()} `,
  );
  t = t.replace(/<command-args>([\s\S]*?)<\/command-args>/g, "$1");
  t = t.replace(
    /<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g,
    (_, c: string) => `(pasted)\n${c.trim()}\n(end of paste)`,
  );
  t = t.replace(
    /<(local-command-stdout|local-command-caveat|local-command-stderr)>[\s\S]*?<\/\1>/g,
    "",
  );
  // an event the app sent in your place (a session finished, a CI check) is
  // not something you said
  if (/^\s*<([a-z-]+-event|task-notification)[\s>]/.test(t)) return "";
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((b: Raw) => b?.type === "text" && typeof b.text === "string")
          .map((b: Raw) => b.text as string)
          .join("\n")
      : "";

const cut = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n).trimEnd()} …` : s;

// New transcript lines into turns. What you typed starts a turn; Claude's
// words until you type again are its reply (its tool calls and their output
// are left out). `seen` holds the entries already read, and grows.
export function readTurns(
  lines: string[],
  turns: Turn[],
  seen: Set<string>,
  now = Date.now(),
  // entries older than this were read before (a moved file starts over)
  since = 0,
): number {
  let added = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let d: Raw;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d?.type !== "user" && d?.type !== "assistant") continue;
    // a compacted conversation's summary is written as yours: it is not
    if (
      d.isSidechain ||
      d.isMeta ||
      d.isCompactSummary ||
      d.isVisibleInTranscriptOnly
    )
      continue;
    const id = typeof d.uuid === "string" ? d.uuid : "";
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const ts = Date.parse(d.timestamp) || now;
    if (ts < since) continue;
    const last = turns[turns.length - 1];
    if (d.type === "user") {
      const text = cleanUserText(textOf(d.message?.content));
      if (!text) continue;
      turns.push({
        n: turns.filter((t) => t.who === "you").length + 1,
        who: "you",
        text: cut(text, TURN_CHARS),
        ts,
      });
      added++;
      continue;
    }
    const text = textOf(d.message?.content).trim();
    if (!text) continue;
    if (last?.who === "claude") {
      last.text = cut(`${last.text}\n\n${text}`, TURN_CHARS);
      last.ts = ts;
    } else {
      turns.push({
        n: last?.n ?? 1,
        who: "claude",
        text: cut(text, TURN_CHARS),
        ts,
      });
      added++;
    }
  }
  return added;
}

// ---- when the map catches up --------------------------------------------------

// The map is brought up to date soon after you say something (what you ask
// is what it should show first), and after Claude's reply once the
// conversation has gone quiet; a long reply still being written is caught
// up with now and then.
export function shouldFollow(s: ChatState, now: number): boolean {
  if (!s.following || s.turns.length <= s.mapped) return false;
  if (s.heldAt && s.turns.length <= s.heldAt) return false;
  const quiet = now - s.activeAt;
  const fresh = s.turns.slice(s.mapped);
  if (fresh.some((t) => t.who === "you") && quiet >= 2500) return true;
  if (quiet >= 8000) return true;
  return now - fresh[0].ts >= 90_000 && quiet >= 2500;
}

// The turns a catch-up move is sent: the new ones, and the one before them
// for what they answer. A long run is sent in shorter pieces per turn.
// where the next catch-up stops: a long run of new turns is filed a batch at
// a time
export const batchEnd = (s: ChatState) =>
  Math.min(s.turns.length, s.mapped + BATCH_TURNS);

export function digest(s: ChatState): string {
  const from = Math.max(0, s.mapped - 1);
  const part = s.turns.slice(from, Math.max(s.upTo, s.mapped) || undefined);
  if (!part.length) return "";
  const each = Math.max(
    TURN_FLOOR,
    Math.min(TURN_CHARS, Math.floor(DIGEST_CHARS / part.length)),
  );
  return part
    .map(
      (t, i) =>
        `[turn ${t.n}] ${t.who === "you" ? "USER" : "CLAUDE"}${from + i < s.mapped ? " (already mapped)" : ""}: ${cut(t.text, each)}`,
    )
    .join("\n\n");
}

// ---- items ---------------------------------------------------------------------

const STATES: Record<ItemType, ItemState[]> = {
  topic: [],
  note: [],
  decision: [],
  task: ["pending", "done", "dropped"],
  question: ["open", "answered"],
  option: ["open", "chosen", "dropped"],
};

// the core node's kind and status for an item, so the shared panels read it
export function nodeShape(item: Item): { kind: string; status: string } {
  if (item.type === "task")
    return {
      kind: "question",
      status: item.state === "pending" ? "open" : "answered",
    };
  if (item.type === "question")
    return { kind: "question", status: item.state ?? "open" };
  if (item.type === "decision") return { kind: "option", status: "chosen" };
  if (item.type === "option")
    return {
      kind: "option",
      status:
        item.state === "chosen"
          ? "chosen"
          : item.state === "dropped"
            ? "dropped"
            : "proposed",
    };
  return { kind: "fact", status: "info" };
}

// A node op from the model, before core applies it: its type and state are
// kept here, and its kind and status follow from them. Yours stays yours: a
// task you ticked keeps the state you gave it.
export function cleanItemOp(
  s: ChatState,
  op: Raw,
  nodes?: Record<string, MapNode>,
  // a side chat's node: it may change only that node and what is under it
  scope: string | null = null,
): void | false {
  // the id as core reads it, so an item and its node never differ
  const id = String(op.id ?? "").trim();
  if (!safeId(id)) return false;
  if (id === ROOT && op.op === "add") return false;
  const inScope = scope && nodes ? subtree(nodes, scope) : null;
  const cur = own(s.items, id);
  // what core will refuse is not recorded here either
  if (inScope && cur && !inScope.has(id)) return false;
  // a side chat adds under its own node whatever parent it names
  const parent =
    inScope && !inScope.has(String(op.parent ?? "")) ? scope : op.parent;
  // what hangs from the conversation itself is a topic, whatever the op says:
  // the trunk is the conversation's topics, and their items hang from them
  const top = op.op === "add" && !cur && (!parent || parent === ROOT);
  const type = top
    ? "topic"
    : ITEM_TYPES.includes(op.type)
      ? (op.type as ItemType)
      : null;
  const item: Item = cur ?? { type: type ?? "note" };
  // a question once answered may become the decision it led to
  if (type && type !== item.type && !item.byYou) {
    item.type = type;
    delete item.state;
  }
  const allowed = STATES[item.type];
  if (allowed.includes(op.state) && !item.byYou) item.state = op.state;
  if (!item.state && allowed.length) item.state = allowed[0];
  const turn = Number(op.turn);
  if (Number.isInteger(turn) && turn > 0 && !item.turn) item.turn = turn;
  s.items[id] = item;
  const shape = nodeShape(item);
  op.kind = shape.kind;
  op.status = shape.status;
  // core keeps a node's kind once it is made: a new type changes it here
  const node = nodes?.[id];
  if (node && node.kind !== shape.kind) {
    node.kind = shape.kind as MapNode["kind"];
    node.status = shape.status as MapNode["status"];
  }
}

// an item whose node is gone goes with it
export function prune(s: ChatState, nodes: Record<string, MapNode>) {
  for (const id of Object.keys(s.items)) if (!nodes[id]) delete s.items[id];
}

export function setTask(
  s: ChatState,
  nodes: Record<string, MapNode>,
  id: string,
  state: ItemState,
): MapNode | null {
  if (!safeId(id)) return null;
  const item = own(s.items, id);
  const node = own(nodes, id);
  if (!item || !node || !STATES[item.type]?.includes(state)) return null;
  item.state = state;
  item.byYou = true;
  const shape = nodeShape(item);
  node.status = shape.status as MapNode["status"];
  node.updatedAt = Date.now();
  return node;
}

// ---- the map as the model reads it -------------------------------------------

export function canvasOf(map: StoredMap, s: ChatState): string {
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of Object.values(map.nodes)
      .filter((x) => x.parent === parent)
      .sort((a, b) => a.order - b.order)) {
      const it = s.items[n.id];
      const what =
        n.id === ROOT
          ? "conversation"
          : `${it?.type ?? "note"}${it?.state ? ` · ${it.state}` : ""}`;
      lines.push(
        `${"  ".repeat(depth)}- [${n.id}] ${what}${it?.turn ? ` · turn ${it.turn}` : ""}${it?.byYou ? " (ticked by user)" : ""} · ${n.title}${n.summary ? ` — ${n.summary}` : ""}`,
      );
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n") || "(empty)";
}

// ---- what the main conversation has not heard ------------------------------

export function post(s: ChatState, text: string, now = Date.now()) {
  s.outbox.push({ ts: now, text: cut(text, 1500) });
  const extra = s.outbox.length - OUTBOX_KEEP;
  if (extra > 0) {
    s.outbox.splice(0, extra);
    s.sent = Math.max(0, s.sent - extra);
  }
}

// what is new since the main conversation last asked, and it is marked heard
export function takeUnsent(s: ChatState): Outgoing[] {
  const out = s.outbox.slice(s.sent);
  s.sent = s.outbox.length;
  return out;
}

// ---- the context file ------------------------------------------------------------

// Everything the map knows, as one page a conversation (the main one, or a
// new one picking up the work) can read.
export function contextPage(map: StoredMap, s: ChatState): string {
  const nodes = Object.values(map.nodes);
  const of = (type: ItemType, state?: ItemState) =>
    nodes.filter(
      (n) =>
        s.items[n.id]?.type === type &&
        (!state || s.items[n.id]?.state === state),
    );
  const line = (n: MapNode) =>
    `- ${n.title}${n.summary ? `: ${n.summary}` : ""}`;
  const sides = Object.values(map.threads)
    .filter((t) => t.messages.some((m) => m.role === "claude"))
    .map((t) => {
      const on = map.nodes[t.nodeId]?.title ?? "the conversation";
      const asked = t.messages.filter((m) => m.role === "you").at(-1)?.text;
      const answer = t.messages.filter((m) => m.role === "claude").at(-1)?.text;
      return `### On "${on}"\nAsked: ${cut(asked ?? "", 400)}\n\n${cut(answer ?? "", 1200)}`;
    });
  return [
    `# ${map.title}`,
    map.conversation ? `Conversation: ${map.conversation.id}` : "",
    s.summary ? `## Where it stands\n${s.summary}` : "",
    `## Pending\n${of("task", "pending").map(line).join("\n") || "- nothing"}`,
    `## Open questions\n${of("question", "open").map(line).join("\n") || "- none"}`,
    `## Decided\n${of("decision").map(line).join("\n") || "- nothing yet"}`,
    `## Topics\n${of("topic").map(line).join("\n") || "- none yet"}`,
    sides.length ? `## Side chats\n${sides.join("\n\n")}` : "",
    `## Done\n${of("task", "done").map(line).join("\n") || "- nothing yet"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
