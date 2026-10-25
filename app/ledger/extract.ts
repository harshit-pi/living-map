// The extractor: one fresh model call that reads the map so far and the new
// turns, and answers with typed changes to items. Our code checks every
// change before it lands: the model never mints an id, never writes the map's
// text, and can't file what it can't quote.

import {
  isOpen,
  KINDS,
  live,
  outranks,
  STATES,
  toMapItems,
  type Field,
  type Item,
  type Kind,
  type Store,
} from "./items.ts";
import { toMermaid } from "./mermaid.ts";
import type { Turn } from "./transcript.ts";

export const SYSTEM = `You keep a map of one Claude Code conversation between a user and Claude: what is asked, offered, decided and left to do. You are shown the map so far (as a Mermaid mindmap: each item has an id like i12, a type and a state on the ":::" line under it) and the conversation's NEW TURNS. Answer only through the schema, with changes to the map.

Kinds and their states (the first is where a new one starts):
- topic: what a stretch of the conversation is about. Every new turn belongs to a topic: an existing one, or a new one you create.
- question (open, answered, dropped): something asked that needs an answer. owner "you" when only the user can answer it (a choice, a confirmation, information only they have); owner "claude" when Claude will find the answer.
- option (offered, taken, dropped): one of several choices offered for a question; its parent is that question. Mark it taken only when the conversation shows it was chosen.
- decision (decided, reopened): something settled that later work relies on.
- task (to-do, doing, done, dropped): work to be done. owner "claude" for Claude's own work, "you" for what the user must do.
- ask (waiting, done, dropped): Claude waiting on the user for a go-ahead, an approval, or something only they can do (push, merge, sign in, pay).
- assumption (assumed, confirmed, struck): something taken as true without being checked.
- finding (said): a fact established that matters later.

Rules:
- File what matters to someone coming back to this conversation later; skip chit-chat, progress narration and tool details.
- Prefer updating an existing item over creating a near-duplicate. When a question is answered, an ask is done, an option is taken or a task finishes, update its state.
- Every batch, check the map's open items against the new turns: an item the conversation has answered, finished or moved past gets its new state (an ask the user replied to, or that the work went on without, is done or dropped; a question nobody pursues further is dropped). Stale open items are the worst mistake: the user trusts "waiting on you".
- Options only when at least two were offered for the same question. A single proposal the user says yes or no to ("Want me to…?") is an ask, done or dropped, not an option.
- A problem Claude names as still unfixed or not yet tried is an open task (owner claude) until it is fixed or dropped. A finding only when later work depends on it: most turns have none.
- Every create needs "quote": words copied exactly from the turn named in "turn" (at most 25 words). An update that changes state should quote the turn that shows it.
- "turn" is always one of the NEW TURNS. Name new items "new1", "new2", ...; you may use those refs as parents later in the same answer.
- A non-topic item's parent is the item it belongs under (an option under its question, a finding under the option it is about), or its topic.
- "topics" gives, for every new turn, the id or ref of its topic.
- Titles are short (under 12 words), in plain words, saying what the item is, not where it was said.
- Never invent: if the turns don't show it, don't file it.`;

const OPS = ["create", "update", "retire"] as const;

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topics", "ops"],
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["turn", "topic"],
        properties: {
          turn: { type: "integer" },
          topic: { type: "string" },
        },
      },
    },
    ops: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "turn"],
        properties: {
          op: { type: "string", enum: OPS },
          ref: { type: "string" },
          item: { type: "string" },
          type: { type: "string", enum: KINDS },
          title: { type: "string" },
          body: { type: "string" },
          quote: { type: "string" },
          turn: { type: "integer" },
          parent: { type: "string" },
          owner: { type: "string", enum: ["you", "claude"] },
          state: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export type Op = {
  op: (typeof OPS)[number];
  ref?: string;
  item?: string;
  type?: Kind;
  title?: string;
  body?: string;
  quote?: string;
  turn: number;
  parent?: string;
  owner?: "you" | "claude";
  state?: string;
  reason?: string;
};
export type Answer = { topics: { turn: number; topic: string }[]; ops: Op[] };

// What a turn shows the model: your words in full (up to a cap), Claude's
// beginning and end, where questions and options usually are.
const PROMPT_MAX = 4000;
const REPLY_HEAD = 1500;
const REPLY_TAIL = 3500;
export function clip(text: string, head: number, tail = 0): string {
  if (text.length <= head + tail) return text;
  return `${text.slice(0, head)}\n[…]\n${tail ? text.slice(-tail) : ""}`;
}

export function renderTurns(turns: Turn[]): string {
  return turns
    .map(
      (t) =>
        `TURN ${t.n} · YOU:\n${clip(t.text, PROMPT_MAX)}\n\nTURN ${t.n} · CLAUDE:\n${clip(t.reply, REPLY_HEAD, REPLY_TAIL) || "(no words)"}`,
    )
    .join("\n\n");
}

// The map as the model reads it: a settled topic is one line, everything in
// a topic still in play is shown whole.
export function renderMap(s: Store): string {
  const items = toMapItems(s);
  const settled = new Set(
    items
      .filter((i) => i.type === "topic" && i.state === "done")
      .map((i) => i.id),
  );
  const hidden = new Set<string>();
  const hide = (id: string) => {
    for (const i of items)
      if (i.parent === id) {
        hidden.add(i.id);
        hide(i.id);
      }
  };
  for (const t of settled) hide(t);
  return toMermaid(
    items.filter((i) => !hidden.has(i.id)),
    { title: s.title, conv: s.conv, seq: s.read },
  );
}

// What is still open is listed again on its own: a model reading a whole
// map tends to file the new and forget to close the old, and a stale
// "waiting on you" is the mistake that costs the most trust.
export function checklist(s: Store): string {
  const open = live(s).filter(isOpen);
  if (!open.length) return "(nothing open)";
  return open
    .map(
      (i) =>
        `- ${i.id} ${i.type} ${i.state}${i.owner ? ` owner=${i.owner}` : ""} (turn ${i.src.at(-1)}): ${i.title}`,
    )
    .join("\n");
}

export function message(s: Store, turns: Turn[]): string {
  return `MAP SO FAR:\n${renderMap(s)}\n\nSTILL OPEN (for each, do the new turns answer, finish, drop or move past it? If so, update it):\n${checklist(s)}\n\nNEW TURNS:\n${renderTurns(turns)}`;
}

// quotes are compared loosely: models normalise spacing, quotes and markdown
const loose = (s: string) =>
  s
    .normalize("NFKC")
    // a markdown link reads as its text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export type Rejected = { op: Op; why: string };

// Applies a checked answer as the extractor (the lowest writer). Every op is
// checked on its own; a bad op is rejected and the rest still land.
export function apply(
  s: Store,
  answer: Answer,
  turns: Turn[],
): { applied: Op[]; rejected: Rejected[] } {
  const byTurn = new Map(turns.map((t) => [t.n, t]));
  const refs = new Map<string, string>();
  const applied: Op[] = [];
  const rejected: Rejected[] = [];
  const resolve = (x?: string) =>
    x === undefined ? undefined : (refs.get(x) ?? x);
  const exists = (id?: string) =>
    !!id && !!s.items.get(id) && !s.items.get(id)!.retired;
  // exact after normalising, or nearly: almost every word of the quote is
  // in the turn (models drop a word or fix a typo when they copy)
  const quoted = (op: Op) => {
    const t = byTurn.get(op.turn);
    if (!t || !op.quote?.trim()) return false;
    const q = loose(op.quote);
    const hay = loose(`${t.text}\n${t.reply}`);
    if (q.length < 3) return false;
    if (hay.includes(q)) return true;
    const words = q.split(/\W+/).filter((w) => w.length > 2);
    const have = new Set(hay.split(/\W+/));
    return (
      words.length >= 4 &&
      words.filter((w) => have.has(w)).length / words.length >= 0.85
    );
  };
  const reject = (op: Op, why: string) => rejected.push({ op, why });

  // A create the model gave no ref is still named by its place among the
  // creates (new1, new2, ...): models refer to them that way when they
  // forget to name them.
  const named = new Set(answer.ops.flatMap((o) => (o.ref ? [o.ref] : [])));
  let k = 0;
  for (const o of answer.ops)
    if (o.op === "create") {
      k++;
      if (!o.ref && !named.has(`new${k}`)) o.ref = `new${k}`;
    }

  // a turn the answer gave no topic stays with the topic before it
  const topicFor = (turn: number): string | undefined => {
    const own = answer.topics.find((t) => t.turn === turn)?.topic;
    if (own) return own;
    const before = [...answer.topics]
      .filter((t) => t.turn < turn)
      .sort((a, b) => b.turn - a.turn)[0]?.topic;
    if (before) return before;
    const filed = [...s.topicOf.entries()]
      .filter(([n]) => n < turn)
      .sort((a, b) => b[0] - a[0])[0]?.[1];
    return filed;
  };

  // topics first, so every create can fall back to its turn's topic
  const topicOps = answer.ops.filter(
    (o) => o.op === "create" && o.type === "topic",
  );
  const rest = answer.ops.filter((o) => !topicOps.includes(o));
  for (const op of [...topicOps, ...rest]) {
    if (!byTurn.has(op.turn)) {
      reject(op, `turn ${op.turn} is not one of the new turns`);
      continue;
    }
    if (op.op === "create") {
      const type = op.type;
      if (!type || !KINDS.includes(type)) {
        reject(op, "no valid type");
        continue;
      }
      const title = op.title?.trim();
      if (!title) {
        reject(op, "no title");
        continue;
      }
      if (!quoted(op)) {
        reject(op, "quote not found in its turn");
        continue;
      }
      const state = op.state ?? STATES[type][0]!;
      if (!STATES[type].includes(state)) {
        reject(op, `state "${state}" not allowed for ${type}`);
        continue;
      }
      let parent: string | null = null;
      if (type !== "topic") {
        const p = resolve(op.parent);
        const fallback = resolve(topicFor(op.turn));
        parent = exists(p) ? p! : exists(fallback) ? fallback! : null;
      }
      const id = `i${s.next++}`;
      if (op.ref) refs.set(op.ref, id);
      const item: Item = {
        id,
        type,
        state,
        title: title.slice(0, 120),
        body: op.body?.trim().slice(0, 400) ?? "",
        quote: op.quote!.trim(),
        src: [op.turn],
        parent,
        owner: op.owner,
        basis: "said",
        links: [],
        writers: {
          state: "extractor",
          title: "extractor",
          body: "extractor",
          owner: "extractor",
          parent: "extractor",
        },
      };
      s.items.set(id, item);
      applied.push(op);
      continue;
    }
    const id = resolve(op.item);
    if (!exists(id)) {
      reject(op, `no live item ${op.item}`);
      continue;
    }
    const item = s.items.get(id!)!;
    if (op.op === "retire") {
      item.retired = op.reason?.trim() || "retired by the extractor";
      applied.push(op);
      continue;
    }
    // update: a field someone above the extractor set stays theirs
    const can = (f: Field) => {
      const w = item.writers[f];
      return !w || !outranks(w, "extractor");
    };
    if (op.state !== undefined) {
      if (!STATES[item.type].includes(op.state) || item.type === "topic") {
        reject(op, `state "${op.state}" not allowed for ${item.type}`);
        continue;
      }
      // a state change lands even when its quote doesn't check out: an
      // item left open by mistake costs more than one closed a turn early
      if (can("state")) item.state = op.state;
    }
    if (op.title?.trim() && can("title"))
      item.title = op.title.trim().slice(0, 120);
    if (op.body?.trim() && can("body"))
      item.body = op.body.trim().slice(0, 400);
    if (op.owner && can("owner")) item.owner = op.owner;
    const p = resolve(op.parent);
    if (p && p !== item.id && exists(p) && can("parent")) item.parent = p;
    if (!item.src.includes(op.turn)) item.src.push(op.turn);
    applied.push(op);
  }

  for (const t of turns) {
    const id = resolve(topicFor(t.n));
    if (exists(id) && s.items.get(id!)!.type === "topic")
      s.topicOf.set(t.n, id!);
  }
  s.read = Math.max(s.read, ...turns.map((t) => t.n));
  return { applied, rejected };
}

// When to run: at once after a turn that ends asking or offering something,
// otherwise once 3 turns are waiting. (Live, 20 s of quiet also triggers.)
export function asksSomething(t: Turn): boolean {
  const tail = t.reply.trim().slice(-600);
  return (
    /\?\s*$/.test(tail) ||
    /\n\s*(?:\d+[.)]|[-*•])\s+\S/.test(tail) ||
    /\b(want me to|should i|shall i|which (?:one|option)|let me know)\b/i.test(
      tail,
    )
  );
}

export function batches(turns: Turn[], size = 3): Turn[][] {
  const out: Turn[][] = [];
  let cur: Turn[] = [];
  for (const t of turns) {
    cur.push(t);
    if (cur.length >= size || asksSomething(t)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}
