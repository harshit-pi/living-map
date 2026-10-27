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
  filing?: LedgerView["health"]["filing"];
  lag?: LedgerView["health"]["lag"];
  spend: LedgerView["spend"];
  changes?: ChangeStatement[];
  told?: Map<string, { at: number; heard: boolean }>;
  proposals?: Map<string, number>; // pending side-chat proposals per item
  sides?: LedgerView["sides"];
  // what Claude is on from its own task list (tasks.ts); absent when it
  // keeps none, and a task of Claude's the map filed stands in
  doing?: string | null;
};

const first = (i: Item) => i.src[0] ?? 0;
const n = (id: string) => Number(id.slice(1)) || 0;

// The topic of the latest turn the map filed (the extractor names one for
// every turn), still live; else the newest topic.
function nowOf(s: State): string | null {
  const { store } = s;
  const turns = [...store.topicOf.keys()].sort((a, b) => b - a);
  for (const t of turns) {
    const id = store.topicOf.get(t)!;
    const i = store.items.get(id);
    if (i && !i.retired) return id;
  }
  return (
    live(store)
      .filter((i) => i.type === "topic")
      .sort((a, b) => n(b.id) - n(a.id))[0]?.id ?? null
  );
}

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
    waiting: isWaiting(i, store.read),
    open: isOpen(i),
    isNew: first(i) > looked,
    order: s.meta.get(i.id)?.order ?? "",
    ...(s.meta.get(i.id)?.folded ? { folded: true } : {}),
    ...(f.told?.get(i.id) ? { sent: f.told.get(i.id) } : {}),
    ...(f.proposals?.get(i.id) ? { proposals: f.proposals.get(i.id) } : {}),
  }));
  const waiting = live(store)
    .filter((i) => isWaiting(i, store.read))
    .sort((a, b) => first(a) - first(b) || n(a.id) - n(b.id));
  // what Claude is on: its own task in progress, the newest if several
  // what Claude is on: its own task list says; else a task of Claude's the
  // map filed as in progress, only while it came up in the last few turns
  // (the map is slow to see a task finish)
  const doing =
    f.doing !== undefined
      ? f.doing
      : (live(store)
          .filter(
            (i) =>
              i.type === "task" &&
              i.state === "doing" &&
              i.owner !== "you" &&
              store.read - (i.src.at(-1) ?? 0) <= 3,
          )
          .sort((a, b) => n(b.id) - n(a.id))[0]?.title ?? null);
  return {
    conv: conv.root,
    title: conv.title,
    turns: f.turns,
    read: store.read,
    lookedTurn: looked,
    items,
    now: nowOf(s),
    strip: {
      doing,
      waiting: waiting.map((i) => i.id),
    },
    changes: f.changes ?? [],
    sides: f.sides ?? [],
    spend: f.spend,
    health: {
      following: f.following,
      behind: f.behind,
      ...(f.error ? { error: f.error } : {}),
      ...(f.reading ? { reading: f.reading } : {}),
      ...(f.filing ? { filing: f.filing } : {}),
      ...(f.lag ? { lag: f.lag } : {}),
    },
  };
}
