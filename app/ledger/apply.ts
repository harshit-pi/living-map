// Changes to a chat's items, in memory, before db.ts writes them in one
// transaction: an extractor's answer (checked op by op in extract.ts), and
// what you do on the map, which is written as "you" and never overwritten by
// the extractor. Every item gets its place among its siblings here.

import type { LogLine, State } from "./db.ts";
import { apply, type Answer, type Op } from "./extract.ts";
import { STATES, type Item } from "./items.ts";
import { keyAfter } from "./order.ts";
import type { Turn } from "./transcript.ts";
import type { LedgerAction } from "../shared/ledger.ts";

const n = (id: string) => Number(id.slice(1)) || 0;

// A new item, or one moved under another parent, goes after the last of its
// new siblings; every other item keeps its key, so nothing above it moves.
export function place(s: State, now: number) {
  const items = [...s.store.items.values()].sort((a, b) => n(a.id) - n(b.id));
  for (const i of items) {
    const m = s.meta.get(i.id);
    if (m && m.under === i.parent) continue;
    const siblings = items
      .filter(
        (o) =>
          o.id !== i.id &&
          s.meta.get(o.id)?.under === i.parent &&
          o.parent === i.parent,
      )
      .map((o) => s.meta.get(o.id)!.order);
    s.meta.set(i.id, {
      order: keyAfter(siblings),
      under: i.parent,
      folded: m?.folded ?? false,
      filedAt: m?.filedAt ?? now,
    });
  }
}

const OPS = new Set(["create", "update", "retire"]);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// The model's answer is untrusted even though the CLI held it to the
// schema: anything not shaped like an op is dropped here, the rest is
// checked by apply().
export function checkAnswer(v: unknown): Answer | null {
  if (!v || typeof v !== "object") return null;
  const raw = v as { topics?: unknown; ops?: unknown };
  if (!Array.isArray(raw.topics) || !Array.isArray(raw.ops)) return null;
  const topics = raw.topics
    .filter(
      (t): t is { turn: number; topic: string } =>
        !!t &&
        typeof t === "object" &&
        Number.isInteger((t as { turn?: unknown }).turn) &&
        typeof (t as { topic?: unknown }).topic === "string",
    )
    .map((t) => ({ turn: t.turn, topic: t.topic }));
  const ops: Op[] = [];
  for (const o of raw.ops as Record<string, unknown>[]) {
    if (!o || typeof o !== "object") continue;
    if (!OPS.has(String(o.op)) || !Number.isInteger(o.turn)) continue;
    ops.push({
      op: o.op as Op["op"],
      turn: o.turn as number,
      ref: str(o.ref),
      item: str(o.item),
      type: str(o.type) as Op["type"],
      title: str(o.title),
      body: str(o.body),
      quote: str(o.quote),
      parent: str(o.parent),
      owner: o.owner === "you" || o.owner === "claude" ? o.owner : undefined,
      state: str(o.state),
      reason: str(o.reason),
    });
  }
  return { topics, ops };
}

// An extractor's answer applied to the state; the log lines to write with it.
export function applyAnswer(
  s: State,
  answer: Answer,
  turns: Turn[],
  now: number,
) {
  const { applied, rejected } = apply(s.store, answer, turns);
  place(s, now);
  const lines: LogLine[] = applied.map((op) => ({ writer: "extractor", op }));
  return { lines, rejected };
}

// Acting reaches the chat at once: taking an option, reopening a decision,
// finishing a task of yours or something Claude waited on. Other states
// (an assumption confirmed, a question marked answered with no words) are
// the map's own bookkeeping.
function tellOf(s: State, item: Item, state: string): string | undefined {
  const q = item.parent ? s.store.items.get(item.parent) : undefined;
  if (item.type === "option" && state === "taken")
    return `On the map, the user took the option "${item.title}"${q?.type === "question" ? ` for "${q.title}"` : ""}.`;
  if (item.type === "decision" && state === "reopened")
    return `On the map, the user reopened the decision "${item.title}": it is open again.`;
  if (item.type === "task" && state === "done" && item.owner !== "claude")
    return `On the map, the user marked their task "${item.title}" done.`;
  if (item.type === "ask" && state === "done")
    return `On the map, the user marked "${item.title}" done: they have dealt with it.`;
  return undefined;
}

export type Acted = {
  lines: LogLine[];
  error?: string;
  // words for the main chat, delivered through its inbox (layer/view.ts)
  tell?: string;
  quiet?: boolean; // the words wait for your next message there
  about?: string; // the item they are about: its card says when they arrive
};

// What you did on the map, as writer "you". `turns` is how many turns the
// chat has now (for "looked").
export function applyAction(s: State, a: LedgerAction, turns: number): Acted {
  if (a.type === "looked") {
    s.conv.lookedTurn = Math.max(s.conv.lookedTurn, turns);
    return { lines: [{ writer: "you", op: { op: "looked", turn: turns } }] };
  }
  if (a.type === "review")
    // statements come with phase 6; db.review() files a review when they do
    return { lines: [], error: "There is no such change." };
  // side chats are sides.ts' own
  if (!("item" in a) || a.type === "side-open")
    return { lines: [], error: "That action is not known." };
  const item = s.store.items.get(String(a.item ?? ""));
  if (!item || item.retired)
    return { lines: [], error: "There is no such item." };
  if (a.type === "state") {
    const state = String(a.state ?? "");
    if (item.type === "topic" || !STATES[item.type].includes(state))
      return {
        lines: [],
        error: `A ${item.type} can't be "${state.slice(0, 40)}".`,
      };
    item.state = state;
    item.writers.state = "you";
    return {
      lines: [{ writer: "you", op: { op: "update", item: item.id, state } }],
      tell: tellOf(s, item, state),
    };
  }
  if (a.type === "not-right") {
    item.retired = "not right";
    // the eval reads these: what the extractor filed that you said was wrong
    return {
      lines: [
        {
          writer: "you",
          op: {
            op: "miss",
            item: item.id,
            type: item.type,
            state: item.state,
            title: item.title,
            src: item.src,
          },
        },
      ],
    };
  }
  if (a.type === "fold") {
    const m = s.meta.get(item.id);
    if (m) m.folded = !!a.folded;
    return {
      lines: [
        {
          writer: "you",
          op: { op: "fold", item: item.id, folded: !!a.folded },
        },
      ],
    };
  }
  if (a.type === "answer") {
    const words = String(a.text ?? "")
      .trim()
      .slice(0, 4000);
    if (!words) return { lines: [], error: "Write an answer first." };
    // an answered question or ask is settled by you; the chat hears why
    const settled =
      item.type === "question" ? "answered" : item.type === "ask" ? "done" : "";
    if (settled) {
      item.state = settled;
      item.writers.state = "you";
    }
    return {
      lines: [
        {
          writer: "you",
          op: {
            op: "answer",
            item: item.id,
            text: words,
            ...(settled ? { state: settled } : {}),
          },
        },
      ],
      tell: `On the map, the user answered "${item.title}": ${words}`,
    };
  }
  return { lines: [], error: "That action is not known." };
}
