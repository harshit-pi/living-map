// What the map draws, and how it opens: every item but findings, which stay
// in the card and the list. A decision keeps its box under the topic it was
// made in, so you can see where it was decided. Every topic but the one
// Claude is on starts folded.

import { nowTopic } from "./lens.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

export const onMap = (i: LedgerItem) => i.type !== "finding";

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

// The item you picked and every item above it, up to its top topic: the
// trail the map colours, so a box picked from the list is easy to find and
// to place.
export function trailOf(items: LedgerItem[], id: string | null): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Set<string>();
  let at = id;
  while (at && !out.has(at)) {
    const i = byId.get(at);
    if (!i) break;
    out.add(at);
    at = i.parent;
  }
  return out;
}
