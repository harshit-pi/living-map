// Matching the extractor's lists against the labeler's, with no model call,
// so the extractor eval scores the same way every time it is run. Two
// entries match when they sit in the same list, come from nearly the same
// turn and are titled with mostly the same words; each entry matches at most
// once, best pairs first.

import type { Item } from "./items.ts";

export const LIST_NAMES = ["waiting", "open", "decided", "taken"] as const;
export type ListName = (typeof LIST_NAMES)[number];

// one entry the labeler wrote: what it is and the turn that puts it in its
// list (taken options also say which question they answer)
export type Label = {
  title: string;
  turn: number;
  note?: string;
  question?: string;
};
export type LabelLists = Record<ListName, Label[]>;

export type Pair = { item: Item; label: Label; score: number };
export type Match = { pairs: Pair[]; mapOnly: Item[]; labelOnly: Label[] };

export const TURN_WINDOW = 2;
export const MIN_JACCARD = 0.25;

// words that say nothing about which item a title names
const STOPWORDS = new Set(
  `a an and are as at be but by can could did do does for from has have how
  i if in into is it its it's me my no not of on or our should so that the
  their them then there these this to up us was we were what when where which
  who whether why will with would you your yours`.split(/\s+/),
);

// lowercased words minus stopwords; a plural "s" is dropped so "tests" and
// "test" count as one word
export function tokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const w of title.toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
    const t = w.replace(/^'+|'+$/g, "");
    if (!t || STOPWORDS.has(t)) continue;
    out.add(
      t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t,
    );
  }
  return out;
}

// Jaccard of the two titles' words, or null when they are too far apart to
// match; a title whose words all appear in the other's matches however short
export function similarity(a: string, b: string): number | null {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return null;
  let both = 0;
  for (const t of ta) if (tb.has(t)) both++;
  const jaccard = both / (ta.size + tb.size - both);
  const subset = both === Math.min(ta.size, tb.size);
  return jaccard >= MIN_JACCARD || subset ? jaccard : null;
}

const near = (item: Item, turn: number) =>
  item.src.some((s) => Math.abs(s - turn) <= TURN_WINDOW);

const distance = (item: Item, turn: number) =>
  Math.min(...item.src.map((s) => Math.abs(s - turn)));

// One list: every candidate pair is scored, then taken best first (ties go to
// the nearer turn, then the earlier entries), each side used once.
export function matchList(items: Item[], labels: Label[]): Match {
  const cands: { i: number; l: number; score: number; dist: number }[] = [];
  items.forEach((item, i) =>
    labels.forEach((label, l) => {
      if (!near(item, label.turn)) return;
      const score = similarity(item.title, label.title);
      if (score === null) return;
      cands.push({ i, l, score, dist: distance(item, label.turn) });
    }),
  );
  cands.sort(
    (a, b) => b.score - a.score || a.dist - b.dist || a.i - b.i || a.l - b.l,
  );
  const usedI = new Set<number>();
  const usedL = new Set<number>();
  const pairs: Pair[] = [];
  for (const c of cands) {
    if (usedI.has(c.i) || usedL.has(c.l)) continue;
    usedI.add(c.i);
    usedL.add(c.l);
    pairs.push({ item: items[c.i]!, label: labels[c.l]!, score: c.score });
  }
  return {
    pairs,
    mapOnly: items.filter((_, i) => !usedI.has(i)),
    labelOnly: labels.filter((_, l) => !usedL.has(l)),
  };
}

// The labeler lists what waits on you once, under waiting; the map's open
// list holds those too (isOpen), so open is scored against both.
export function asListed(labels: LabelLists): LabelLists {
  const open = [...labels.waiting];
  const seen = new Set(open.map((l) => key(l)));
  for (const l of labels.open) if (!seen.has(key(l))) open.push(l);
  return { ...labels, open };
}

const key = (l: Label) => `${l.turn}|${[...tokens(l.title)].sort().join(" ")}`;

// Every list of one checkpoint: the map's lists are item ids into `items`
// (ids it no longer has are skipped).
export function matchLists(
  items: Item[],
  lists: Record<ListName, string[]>,
  labels: LabelLists,
): Record<ListName, Match> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = {} as Record<ListName, Match>;
  for (const name of LIST_NAMES) {
    const mine = (lists[name] ?? []).flatMap((id) => byId.get(id) ?? []);
    out[name] = matchList(mine, labels[name] ?? []);
  }
  return out;
}
