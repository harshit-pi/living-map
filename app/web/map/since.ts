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

export function snapOf(v: LedgerView, inOrder: string[]): Snap | null {
  const fresh = new Set(v.items.filter((i) => i.isNew).map((i) => i.id));
  const ids = inOrder.filter((id) => fresh.has(id));
  const s = v.strip.since;
  if (!ids.length && !s.waiting && !s.changes) return null;
  return { turns: s.turns, waiting: s.waiting, changes: s.changes, ids };
}
