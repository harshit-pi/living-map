// What the map draws, and how it opens: the map keeps to what is still in
// play. Findings and settled decisions stay in the card and the list, and
// every topic but the one Claude is on starts folded.

import { nowTopic } from "./lens.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

export const onMap = (i: LedgerItem) =>
  !(i.type === "finding" || (i.type === "decision" && i.state === "decided"));

// The items the map lays out: hidden ones leave, and what sat under one
// hangs from the nearest item still drawn (or the chat's root).
export function mapItems(items: LedgerItem[]): LedgerItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = (id: string | null) => {
    const seen = new Set<string>();
    let at = id;
    while (at && !seen.has(at)) {
      seen.add(at);
      const i = byId.get(at);
      if (!i) return null;
      if (onMap(i)) return at;
      at = i.parent;
    }
    return null;
  };
  return items.filter(onMap).map((i) => {
    const parent = shown(i.parent);
    return parent === i.parent ? i : { ...i, parent };
  });
}

// The folds the page opens with: every topic but the one Claude is on.
// Worked out once, when the page opens, so a topic never folds under you
// while you look; topics that come later stay open.
export function startFolds(
  items: LedgerItem[],
  told?: string | null,
): Record<string, boolean> {
  const now = nowTopic(items, told)?.id;
  const out: Record<string, boolean> = {};
  for (const i of items)
    if (i.type === "topic" && i.id !== now && !i.parent) out[i.id] = true;
  return out;
}
