import type { LedgerView } from "../../shared/ledger.ts";

// what you had not seen when you came back: kept until you close it, so the
// bar stays while you step through it even though the server now counts
// from this look
export type Snap = {
  turns: number;
  waiting: number;
  changes: number;
  ids: string[]; // the new items, in map order
};

// The items filed since you last looked. A chat you have never looked at
// (just linked) has none: everything on it would be "new", which says
// nothing and would open the page on a bar stepping through all of it.
export function newIds(v: LedgerView): Set<string> {
  if (v.lookedTurn <= 0) return new Set();
  return new Set(v.items.filter((i) => i.isNew).map((i) => i.id));
}

export function snapOf(v: LedgerView, inOrder: string[]): Snap | null {
  if (v.lookedTurn <= 0) return null;
  const fresh = newIds(v);
  const ids = inOrder.filter((id) => fresh.has(id));
  const s = v.strip.since;
  if (!ids.length && !s.waiting && !s.changes) return null;
  return { turns: s.turns, waiting: s.waiting, changes: s.changes, ids };
}
