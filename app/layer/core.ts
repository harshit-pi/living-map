// The conversation layer's pure logic: reading a Claude Code transcript into
// turns, when the layer should catch up, the items it files (and what is on
// whom), the layer as the model reads it, and what the main conversation has
// not heard yet.

import {
  ITEM_TYPES,
  MODES,
  type Item,
  type ItemState,
  type ItemType,
  type Mode,
  type SideChat,
  type Turn,
} from "./shared.ts";
import {
  own,
  safeId,
  str,
  type Raw,
  type StoredMap,
} from "../server/core/types.ts";

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

// `wake`: the main chat should hear it now, not with your next message there
// (a message to it, a reply on a view, an option you picked); a listener in
// the chat is woken for it
export type Outgoing = {
  ts: number;
  text: string;
  view?: string;
  wake?: boolean;
};

export type LayerState = {
  // the conversation's first id (it gets a new one when resumed)
  id: string;
  // every id the conversation has had, the first one first
  aliases: string[];
  title: string;
  items: Record<string, Item>;
  sides: Record<string, SideChat>;
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
  now: string;
  suggested: { mode: Mode; question: string } | null;
  // why following stopped by itself, if it did
  pausedWhy?: string;
  // what you wrote to the main chat from the map, newest last, and when the
  // main chat last took what was waiting
  told?: { text: string; ts: number }[];
  heardAt?: number;
  // false: views wait for "Update" instead of keeping themselves current
  autoView?: boolean;
  outbox: Outgoing[];
  sent: number; // outbox lines the main conversation has had
};

export const newState = (id = "", title = ""): LayerState => ({
  id,
  aliases: id ? [id] : [],
  title,
  items: {},
  sides: {},
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
  now: "",
  suggested: null,
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
export function shouldFollow(s: LayerState, now: number): boolean {
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
export const batchEnd = (s: LayerState) =>
  Math.min(s.turns.length, s.mapped + BATCH_TURNS);

export function digest(s: LayerState): string {
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

// ---- items -----------------------------------------------------------------------

const STATES: Record<ItemType, ItemState[]> = {
  topic: [],
  note: [],
  decision: [],
  task: ["pending", "active", "done", "dropped"],
  question: ["open", "answered"],
  option: ["open", "chosen", "dropped"],
};

const topicsOf = (s: LayerState) =>
  Object.values(s.items)
    .filter((i) => i.type === "topic")
    .sort((a, b) => a.order - b.order);

export const childrenOf = (s: LayerState, id: string | null) =>
  Object.values(s.items)
    .filter((i) => i.parent === id)
    .sort((a, b) => a.order - b.order);

// an item and everything under it
export function below(s: LayerState, id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of Object.values(s.items))
      if (i.parent && out.has(i.parent) && !out.has(i.id)) {
        out.add(i.id);
        grew = true;
      }
  }
  return out;
}

// Where an item may hang: a topic from nothing (or from a topic, as a
// digression), an option from a question, anything else from a topic. A
// parent that does not fit is replaced by the newest topic.
function fitParent(
  s: LayerState,
  type: ItemType,
  asked: string | null,
): string | null {
  const p = asked ? own(s.items, asked) : undefined;
  if (type === "topic") return p?.type === "topic" ? p.id : null;
  if (type === "option" && p?.type === "question") return p.id;
  if (type !== "option" && p?.type === "topic") return p.id;
  return topicsOf(s).at(-1)?.id ?? null;
}

// An op from a catch-up or a side chat. The model's output is untrusted:
// every field is checked here. A side chat (`scope`: the item it is on) may
// change only that item and what is under it, and files what it adds there.
// Returns how many things changed, or null when the op is not the layer's.
export function applyLayerOp(
  s: LayerState,
  op: Raw,
  { scope = null as string | null, now = Date.now() } = {},
): number | null {
  // the summary and the view are the main chat's: a side chat's is let go
  // quietly (counted as refused, it buried the side chat's answer)
  if (op?.op === "summary") {
    if (scope) return null;
    const text = str(op.text, 1200).trim();
    const doing = str(op.now, 200).trim();
    if (text) s.summary = text;
    if (doing) s.now = doing;
    return text || doing ? 1 : 0;
  }
  if (op?.op === "view") {
    if (scope) return null;
    if (!MODES.includes(op.mode)) return 0;
    s.suggested = {
      mode: op.mode as Mode,
      question: str(op.question, 200).trim(),
    };
    return 1;
  }
  if (op?.op === "forget") {
    const id = String(op.id ?? "").trim();
    const it = safeId(id) ? own(s.items, id) : undefined;
    if (!it || it.byYou) return 0;
    if (scope && !below(s, scope).has(id)) return 0;
    for (const k of below(s, id)) if (!s.items[k]?.byYou) delete s.items[k];
    return 1;
  }
  if (op?.op !== "item") return null;
  const id = String(op.id ?? "").trim();
  if (!safeId(id) || id === "root") return 0;
  const cur = own(s.items, id);
  const inScope = scope && scope !== "root" ? below(s, scope) : null;
  if (cur && inScope && !inScope.has(id)) return 0;
  const type: ItemType = ITEM_TYPES.includes(op.type)
    ? op.type
    : (cur?.type ?? "note");
  let parent = cur ? cur.parent : null;
  if (!cur || op.parent !== undefined)
    parent = fitParent(s, type, op.parent ? String(op.parent) : null);
  // a side chat adds under the item it is on
  if (!cur && inScope && !inScope.has(parent ?? "")) parent = scope;
  const item: Item = cur ?? {
    id,
    parent,
    type,
    title: id,
    summary: "",
    updatedAt: now,
    order: Object.keys(s.items).length,
  };
  if (!cur || !item.byYou) {
    if (type !== item.type) delete item.state;
    item.type = type;
    item.parent = parent === id ? item.parent : parent;
  }
  if (typeof op.title === "string" && op.title.trim())
    item.title = op.title.trim().slice(0, 80);
  if (typeof op.summary === "string")
    item.summary = op.summary.trim().slice(0, 220);
  const allowed = STATES[item.type];
  if (allowed.includes(op.state) && !item.byYou) item.state = op.state;
  if (!item.state && allowed.length) item.state = allowed[0];
  if (!allowed.length) delete item.state;
  if (op.owner === "you" || op.owner === "claude") item.owner = op.owner;
  if (!item.owner && (item.type === "task" || item.type === "question"))
    item.owner = item.type === "question" ? "you" : "claude";
  const turn = Number(op.turn);
  if (Number.isInteger(turn) && turn > 0 && !item.turn) item.turn = turn;
  item.updatedAt = now;
  s.items[id] = item;
  settleChoice(s, item, now);
  return 1;
}

// you ticked, picked or settled it
export function setState(
  s: LayerState,
  id: string,
  state: ItemState,
  now = Date.now(),
): Item | null {
  if (!safeId(id)) return null;
  const item = own(s.items, id);
  if (!item || !STATES[item.type].includes(state)) return null;
  item.state = state;
  item.byYou = true;
  item.updatedAt = now;
  settleChoice(s, item, now);
  return item;
}

// an option taken answers the question it is under; with none taken any
// more, the question is open again
function settleChoice(s: LayerState, item: Item, now: number) {
  if (item.type !== "option" || !item.parent) return;
  const q = own(s.items, item.parent);
  if (q?.type !== "question") return;
  const taken = optionsOf(s, q.id).some((o) => o.state === "chosen");
  const state = taken ? "answered" : "open";
  if (q.state !== state) {
    q.state = state;
    q.updatedAt = now;
  }
}

// ---- what is on whom -------------------------------------------------------------

const optionsOf = (s: LayerState, id: string) =>
  childrenOf(s, id).filter((i) => i.type === "option");

// a question whose options are all still open is a choice waiting on you
export const unpicked = (s: LayerState, q: Item) => {
  const opts = optionsOf(s, q.id);
  return (
    opts.length > 0 &&
    !opts.some((o) => o.state === "chosen") &&
    q.state !== "answered"
  );
};

// what waits on you: a question to you, a choice to make, a step of yours
export const needsYou = (s: LayerState): Item[] =>
  Object.values(s.items)
    .filter(
      (i) =>
        (i.type === "question" &&
          i.state === "open" &&
          (i.owner !== "claude" || unpicked(s, i))) ||
        (i.type === "task" &&
          (i.state === "pending" || i.state === "active") &&
          i.owner === "you"),
    )
    .sort((a, b) => a.order - b.order);

// what Claude has said it will do and has not done yet, what it is on first
export const claudeTodo = (s: LayerState): Item[] =>
  Object.values(s.items)
    .filter(
      (i) =>
        i.type === "task" &&
        (i.state === "pending" || i.state === "active") &&
        i.owner !== "you",
    )
    .sort(
      (a, b) =>
        Number(b.state === "active") - Number(a.state === "active") ||
        a.order - b.order,
    );

// open questions that are not on you (still to talk through)
export const stillOpen = (s: LayerState): Item[] =>
  Object.values(s.items)
    .filter(
      (i) =>
        i.type === "question" &&
        i.state === "open" &&
        i.owner === "claude" &&
        !unpicked(s, i),
    )
    .sort((a, b) => a.order - b.order);

export const decided = (s: LayerState): Item[] =>
  Object.values(s.items)
    .filter(
      (i) =>
        i.type === "decision" ||
        (i.type === "option" && i.state === "chosen") ||
        // a question settled by picking an option is told by the option
        (i.type === "question" &&
          i.state === "answered" &&
          !optionsOf(s, i.id).some((o) => o.state === "chosen")),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || b.order - a.order);

// ---- how far a view is behind the chat ------------------------------------------

// when a view last heard from the model: turns after it are what it has not
// taken in
export function lastMove(map: StoredMap): number {
  let at = map.createdAt;
  for (const c of map.chat) if (c.role === "claude") at = Math.max(at, c.ts);
  for (const t of Object.values(map.threads))
    for (const c of t.messages)
      if (c.role === "claude") at = Math.max(at, c.ts);
  return at;
}

// your turns since that view's last move
export const behind = (s: LayerState, map: StoredMap) => {
  const since = lastMove(map);
  return s.turns.filter((t) => t.who === "you" && t.ts > since).length;
};

// A view keeps itself current (unless you turned that off): once the chat
// has moved on, the rail has filed it, and the chat has gone quiet for a
// while, at most every couple of minutes. Redrawing a view resumes the whole
// conversation, so it waits for a pause rather than following every turn.
export const VIEW_QUIET_MS = 20_000;
export const VIEW_EVERY_MS = 2 * 60_000;
export function viewDue(
  s: LayerState,
  map: StoredMap,
  now: number,
  lastAuto: number,
): boolean {
  return (
    s.autoView !== false &&
    s.following &&
    s.mapped >= s.turns.length &&
    now - s.activeAt >= VIEW_QUIET_MS &&
    now - lastAuto >= VIEW_EVERY_MS &&
    behind(s, map) > 0
  );
}

// ---- the layer as the model reads it ---------------------------------------------

export function outlineOf(s: LayerState): string {
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const i of childrenOf(s, parent)) {
      lines.push(
        `${"  ".repeat(depth)}- [${i.id}] ${i.type}${i.state ? ` · ${i.state}` : ""}${i.owner ? ` · on ${i.owner === "you" ? "user" : "Claude"}` : ""}${i.turn ? ` · turn ${i.turn}` : ""}${i.byYou ? " (set by user)" : ""} · ${i.title}${i.summary ? ` — ${i.summary}` : ""}`,
      );
      walk(i.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n") || "(nothing filed yet)";
}

// ---- what the main conversation has not heard ------------------------------

// What you do on a view, for the main chat: a run of moves on the same view
// (choices, components placed) is one line, not one each.
export function postFromView(
  s: LayerState,
  view: string,
  text: string,
  now = Date.now(),
) {
  const last = s.outbox.at(-1);
  if (
    last &&
    s.outbox.length > s.sent &&
    last.view === view &&
    now - last.ts < 5 * 60_000 &&
    last.text.length < 1200
  ) {
    last.text = `${last.text}; ${text}`;
    last.ts = now;
    return;
  }
  post(s, `On the ${view} view of the map, the user: ${text}`, now);
  s.outbox.at(-1)!.view = view;
}

export function post(
  s: LayerState,
  text: string,
  now = Date.now(),
  wake = false,
) {
  s.outbox.push({ ts: now, text: cut(text, 1500), ...(wake ? { wake } : {}) });
  const extra = s.outbox.length - OUTBOX_KEEP;
  if (extra > 0) {
    s.outbox.splice(0, extra);
    s.sent = Math.max(0, s.sent - extra);
  }
}

// something the main chat should hear now is waiting
export const wakes = (s: LayerState) =>
  s.outbox.slice(s.sent).some((o) => o.wake);

// what is new since the main conversation last asked, and it is marked heard
export function takeUnsent(s: LayerState): Outgoing[] {
  const out = s.outbox.slice(s.sent);
  s.sent = s.outbox.length;
  return out;
}

// ---- the context file ------------------------------------------------------------

// Everything the map knows, as one page a conversation (the main one, or a
// new one picking up the work) can read.
export function contextPage(s: LayerState): string {
  const line = (i: Item) => `- ${i.title}${i.summary ? `: ${i.summary}` : ""}`;
  const list = (items: Item[], none: string) =>
    items.map(line).join("\n") || `- ${none}`;
  const sides = Object.values(s.sides)
    .filter((t) => t.lines.some((l) => l.role === "claude"))
    .map((t) => {
      const asked = t.lines.filter((l) => l.role === "you").at(-1)?.text;
      const answer = t.lines.filter((l) => l.role === "claude").at(-1)?.text;
      return `### On "${t.title}"\nAsked: ${cut(asked ?? "", 400)}\n\n${cut(answer ?? "", 1200)}`;
    });
  return [
    `# ${s.title || "Conversation"}`,
    `Conversation: ${s.id}`,
    s.summary ? `## Where it stands\n${s.summary}` : "",
    s.now ? `## Claude is on\n${s.now}` : "",
    `## Waiting on the user\n${list(needsYou(s), "nothing")}`,
    `## Claude still to do\n${list(claudeTodo(s), "nothing")}`,
    `## Still to talk through\n${list(stillOpen(s), "nothing")}`,
    `## Decided\n${list(decided(s), "nothing yet")}`,
    `## Topics\n${list(topicsOf(s), "none yet")}`,
    sides.length ? `## Side chats\n${sides.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
