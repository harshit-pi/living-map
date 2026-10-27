// What the map's lenses, counts, list and search read from the items: pure,
// so the canvas, the drawer and the strip agree on every count.

import { childrenMap } from "./layout.ts";
import type { ChangeStatement, LedgerItem } from "../../shared/ledger.ts";

export type Lens = "waiting" | "open" | "decided" | "changed";

export const LENSES: { id: Lens; label: string }[] = [
  { id: "waiting", label: "Waiting" },
  { id: "open", label: "Open" },
  { id: "decided", label: "Decided" },
  { id: "changed", label: "Changed" },
];

export const isDecided = (i: LedgerItem) =>
  (i.type === "decision" && i.state === "decided") ||
  (i.type === "option" && i.state === "taken");

const DROPPED = new Set(["dropped", "struck"]);
export const isDropped = (i: LedgerItem) => DROPPED.has(i.state);

// tied to a change in your system: filed on a turn that changed it, or
// linking to one of the changes
export function changedIds(
  items: LedgerItem[],
  changes: ChangeStatement[],
): Set<string> {
  const shown = changes.filter((c) => !c.low);
  const turns = new Set(shown.map((c) => c.turn));
  const ids = new Set(shown.map((c) => c.id));
  return new Set(
    items
      .filter(
        (i) =>
          i.type !== "topic" &&
          (i.src.some((t) => turns.has(t)) ||
            i.links.some((l) => ids.has(l.to))),
      )
      .map((i) => i.id),
  );
}

export function matcher(
  lens: Lens,
  changed: Set<string>,
): (i: LedgerItem) => boolean {
  if (lens === "waiting") return (i) => i.waiting;
  if (lens === "open") return (i) => i.open && i.type !== "topic";
  if (lens === "decided") return isDecided;
  return (i) => changed.has(i.id);
}

// what the items waiting on you hold up: everything a waiting item links to
// with "blocks", and what those block in turn
export function heldUp(items: LedgerItem[]): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Set<string>();
  const walk = (i: LedgerItem) => {
    for (const l of i.links) {
      if (l.rel !== "blocks" || out.has(l.to)) continue;
      const to = byId.get(l.to);
      if (!to) continue;
      out.add(to.id);
      walk(to);
    }
  };
  for (const i of items) if (i.waiting) walk(i);
  return out;
}

// what a lens lights on the map: its own items, and for Waiting also what
// they hold up, so a blocked task reads as blocked. Counts and the stepper
// use matcher(): they say how many wait, not how much waits on them.
export function litBy(
  lens: Lens,
  items: LedgerItem[],
  changed: Set<string>,
): (i: LedgerItem) => boolean {
  const m = matcher(lens, changed);
  if (lens !== "waiting") return m;
  const held = heldUp(items);
  return (i) => m(i) || held.has(i.id);
}

// the items pointing at this one, by what they say of it
export const REVERSE: Record<string, string> = {
  blocks: "held up by",
  answers: "settled by",
};
export function linkedTo(
  items: LedgerItem[],
  id: string,
): { rel: string; from: LedgerItem }[] {
  return items.flatMap((from) =>
    from.links.filter((l) => l.to === id).map((l) => ({ rel: l.rel, from })),
  );
}

// every item under a topic, however deep
export function descendants(items: LedgerItem[], id: string): LedgerItem[] {
  const kids = childrenMap(items);
  const out: LedgerItem[] = [];
  const seen = new Set<string>([id]);
  const walk = (p: string) => {
    for (const c of kids.get(p) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

export type Counts = {
  waiting: number;
  open: number;
  decided: number; // decisions in force and options taken, apart from settled
  settled: number;
};

export function countsOf(under: LedgerItem[]): Counts {
  let waiting = 0;
  let open = 0;
  let decided = 0;
  let settled = 0;
  for (const i of under) {
    if (i.waiting) waiting++;
    else if (i.open) open++;
    else if (isDecided(i)) decided++;
    else settled++;
  }
  return { waiting, open, decided, settled };
}

// "2 waiting · 1 open · 1 decided · 5 settled", leaving out the zeros
export function countsText(c: Counts): string {
  const parts: string[] = [];
  if (c.waiting) parts.push(`${c.waiting} waiting`);
  if (c.open) parts.push(`${c.open} open`);
  if (c.decided) parts.push(`${c.decided} decided`);
  if (c.settled) parts.push(`${c.settled} settled`);
  return parts.join(" · ") || "empty";
}

// the drawer's groups, in the order you check them
export type Group = { id: string; label: string; items: LedgerItem[] };

export function groupsOf(items: LedgerItem[]): Group[] {
  const rest = items.filter((i) => i.type !== "topic");
  const waiting = rest.filter((i) => i.waiting);
  const open = rest.filter((i) => !i.waiting && i.open);
  const decided = rest.filter((i) => !i.waiting && !i.open && isDecided(i));
  const settled = rest.filter(
    (i) => !i.waiting && !i.open && !isDecided(i) && !isDropped(i),
  );
  const dropped = rest.filter((i) => !i.waiting && !i.open && isDropped(i));
  return [
    { id: "waiting", label: "Waiting on you", items: waiting },
    { id: "open", label: "Open", items: open },
    { id: "decided", label: "Decided", items: decided },
    { id: "settled", label: "Settled", items: settled },
    { id: "dropped", label: "Dropped", items: dropped },
  ].filter((g) => g.items.length);
}

// titles holding every word you typed, in any order
export function search(items: LedgerItem[], q: string): LedgerItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return items.filter((i) => {
    const t = i.title.toLowerCase();
    return words.every((w) => t.includes(w));
  });
}

// the folded topics an item sits inside, outermost first
export function foldsAbove(
  items: LedgerItem[],
  id: string,
  folded: (id: string) => boolean,
): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: string[] = [];
  const seen = new Set<string>();
  let p = byId.get(id)?.parent ?? null;
  while (p && byId.has(p) && !seen.has(p)) {
    seen.add(p);
    if (folded(p)) out.unshift(p);
    p = byId.get(p)?.parent ?? null;
  }
  return out;
}

// the topic Now goes to: the newest active one, else the newest topic
// The topic the chat is on: the one whose items came up most recently. A
// topic's "active" state also counts a task left in progress long ago, so
// it can't say where the chat is now.
export function nowTopic(
  items: LedgerItem[],
  // the server's answer, from the topic it filed the latest turn under
  now?: string | null,
): LedgerItem | null {
  const told = now ? items.find((i) => i.id === now) : undefined;
  if (told) return told;
  const topics = items
    .filter((i) => i.type === "topic")
    .sort((a, b) => (a.order < b.order ? -1 : 1));
  let best: LedgerItem | null = null;
  let latest = -1;
  for (const t of topics) {
    const turn = Math.max(
      ...t.src,
      ...descendants(items, t.id).flatMap((i) => i.src),
    );
    if (turn >= latest) {
      latest = turn;
      best = t;
    }
  }
  return best;
}

// the top-level topic an item belongs to
export function topicOf(items: LedgerItem[], id: string): LedgerItem | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.type === "topic") return cur;
    seen.add(cur.id);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return null;
}
