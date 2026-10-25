// What the page sees of a chat's store (LedgerView in shared/ledger.ts):
// live items only, each with its place and whether it is new since you
// last looked, and the strip on top. Pure: the follower passes in what it
// knows of the transcript and the runs.

import type { State } from "./db.ts";
import { isOpen, isWaiting, live, topicState, type Item } from "./items.ts";
import type {
  ChangeStatement,
  LedgerItem,
  LedgerView,
} from "../shared/ledger.ts";

export type Facts = {
  turns: number; // turns in the chat so far
  behind: number; // sealed turns not yet filed
  following: boolean;
  error?: string;
  reading?: { done: number; total: number };
  spend: LedgerView["spend"];
  changes?: ChangeStatement[];
};

const first = (i: Item) => i.src[0] ?? 0;
const n = (id: string) => Number(id.slice(1)) || 0;

export function buildView(s: State, f: Facts): LedgerView {
  const { conv, store } = s;
  const looked = conv.lookedTurn;
  const items: LedgerItem[] = live(store).map((i) => ({
    id: i.id,
    type: i.type,
    state: i.type === "topic" ? topicState(store, i.id) : i.state,
    title: i.title,
    body: i.body,
    quote: i.quote,
    src: i.src,
    parent: i.parent,
    ...(i.owner ? { owner: i.owner } : {}),
    basis: i.basis,
    links: i.links,
    waiting: isWaiting(i),
    open: isOpen(i),
    isNew: first(i) > looked,
    order: s.meta.get(i.id)?.order ?? "",
    ...(s.meta.get(i.id)?.folded ? { folded: true } : {}),
  }));
  const waiting = live(store)
    .filter(isWaiting)
    .sort((a, b) => first(a) - first(b) || n(a.id) - n(b.id));
  // what Claude is on: its own task in progress, the newest if several
  const doing =
    live(store)
      .filter(
        (i) => i.type === "task" && i.state === "doing" && i.owner !== "you",
      )
      .sort((a, b) => n(b.id) - n(a.id))[0]?.title ?? null;
  return {
    conv: conv.root,
    title: conv.title,
    turns: f.turns,
    read: store.read,
    lookedTurn: looked,
    items,
    strip: {
      doing,
      waiting: waiting.map((i) => i.id),
      since: {
        turns: Math.max(0, f.turns - looked),
        waiting: waiting.filter((i) => first(i) > looked).length,
        changes: (f.changes ?? []).filter((c) => !c.low && c.turn > looked)
          .length,
      },
    },
    changes: f.changes ?? [],
    spend: f.spend,
    health: {
      following: f.following,
      behind: f.behind,
      ...(f.error ? { error: f.error } : {}),
      ...(f.reading ? { reading: f.reading } : {}),
    },
  };
}
