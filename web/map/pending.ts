// The box the map shows for turns that are sealed but not yet on it: it
// appears under the topic the chat is on within a second of a turn ending,
// and the items the model files take its place. It is drawn only, never
// filed: not in the counts, the lenses, the list or the cards.

import type { LedgerItem, LedgerView } from "../../shared/ledger.ts";

export const PENDING = "pending";

// which turns are on their way: the run under way, else what is behind
export function pendingTurns(v: LedgerView): number[] {
  if (v.health.filing?.turns.length) return v.health.filing.turns;
  const n = Math.max(0, v.health.behind);
  return Array.from({ length: n }, (_, k) => v.read + 1 + k);
}

export function pendingTitle(turns: number[]): string {
  const a = turns[0]!;
  const b = turns.at(-1)!;
  return a === b ? `Filing turn ${a}…` : `Filing turns ${a}–${b}…`;
}

export function pendingItem(v: LedgerView): LedgerItem | null {
  if (!v.health.following) return null;
  const turns = pendingTurns(v);
  if (!turns.length) return null;
  // under the topic the chat is on, when the map still has it
  const parent =
    v.now && v.items.some((i) => i.id === v.now && i.type === "topic")
      ? v.now
      : null;
  return {
    id: PENDING,
    type: "task",
    state: "doing",
    title: pendingTitle(turns),
    body: "",
    quote: "",
    src: [],
    parent,
    basis: "inferred",
    links: [],
    waiting: false,
    open: false,
    isNew: false,
    // after every real key, which start with a letter: the newest, so it
    // sits first under its topic
    order: "~",
  };
}
