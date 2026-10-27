// The mind map's layout: a tree growing left to right from the chat's root.
// A node's column is its depth; its row is the next free row when it is
// reached in order, and a parent shares the row of its first child. Rows
// are given out in tree order, newest first (siblings by their order key,
// highest first), so the latest topic and the latest item under each sit at
// the top. A new item takes the first row under its parent: every node on
// an earlier row keeps its place, and the rows from it on move down by whole
// rows, which the camera makes up for while you look further down
// (MapScreen). No measuring and no graph layout library: positions follow
// from the items alone, so the same items always land in the same places.

import type { LedgerItem } from "../../shared/ledger.ts";

export const ROOT = "root"; // the chat itself, left of every topic

// How big a node is and how far apart: col and row are px between columns
// and rows. The size follows the pane's width class only, never its exact
// width, so a resize within the class moves nothing.
export type Size = { col: number; row: number; w: number; h: number };
// room for three lines of title, which holds nearly every title whole
export const WIDE: Size = { col: 296, row: 72, w: 264, h: 58 };
// a pane beside the chat: a topic, its items and theirs fit side by side at
// 480 px, with room for three lines of title in each
export const NARROW: Size = { col: 160, row: 66, w: 146, h: 54 };
// panes narrower than this get the narrow size
export const NARROW_PANE = 640;
export const sizeFor = (paneWidth: number): Size =>
  paneWidth < NARROW_PANE ? NARROW : WIDE;

export type Placed = {
  id: string;
  x: number;
  y: number;
  depth: number;
  row: number;
  parent: string | null; // null for the root
};

export type Layout = {
  nodes: Map<string, Placed>;
  order: string[]; // ids in tree order, root first
  rows: number;
  edges: { from: string; to: string }[];
  links: { from: string; to: string; rel: string }[];
};

// order keys compare as plain strings, the way fractional keys are minted
const byOrder = (a: LedgerItem, b: LedgerItem) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1;

// each item's children, newest first; an item whose parent is gone hangs off
// the root
export function childrenMap(items: LedgerItem[]): Map<string, LedgerItem[]> {
  const ids = new Set(items.map((i) => i.id));
  const kids = new Map<string, LedgerItem[]>();
  for (const i of items) {
    const p = i.parent && ids.has(i.parent) ? i.parent : ROOT;
    const list = kids.get(p) ?? [];
    list.push(i);
    kids.set(p, list);
  }
  for (const list of kids.values()) list.sort((a, b) => byOrder(b, a));
  return kids;
}

export function layout(
  items: LedgerItem[],
  folded: (id: string) => boolean = () => false,
  size: Size = WIDE,
): Layout {
  const kids = childrenMap(items);
  const nodes = new Map<string, Placed>();
  const order: string[] = [];
  const edges: Layout["edges"] = [];
  let row = 0;
  // `seen` guards against a parent loop in bad data
  const seen = new Set<string>();
  const place = (id: string, depth: number, parent: string | null) => {
    seen.add(id);
    const first = row;
    nodes.set(id, {
      id,
      x: depth * size.col,
      y: first * size.row,
      depth,
      row: first,
      parent,
    });
    order.push(id);
    if (parent) edges.push({ from: parent, to: id });
    const under = id !== ROOT && folded(id) ? [] : (kids.get(id) ?? []);
    const next = under.filter((c) => !seen.has(c.id));
    if (!next.length) row++;
    for (const c of next) place(c.id, depth + 1, id);
  };
  place(ROOT, 0, null);
  // cross-links between drawn nodes, never along a tree edge
  const links: Layout["links"] = [];
  for (const i of items) {
    if (!nodes.has(i.id)) continue;
    for (const l of i.links) {
      if (!nodes.has(l.to) || l.to === i.parent) continue;
      if (nodes.get(l.to)?.parent === i.id) continue;
      links.push({ from: i.id, to: l.to, rel: l.rel });
    }
  }
  return { nodes, order, rows: row, edges, links };
}

// how far each node kept from `prev` moved in `next`, in px (x, y)
export function moves(prev: Layout, next: Layout) {
  const out: { id: string; dx: number; dy: number; prevY: number }[] = [];
  for (const [id, p] of prev.nodes) {
    const n = next.nodes.get(id);
    if (n) out.push({ id, dx: n.x - p.x, dy: n.y - p.y, prevY: p.y });
  }
  return out;
}

// How far to move the camera, in map px, when new items arrive, so the
// first box at or below `top` (the map y at the top of the pane) stays where
// it is on screen while the rows above it fill in. At the very top of the
// map there is nothing to hold: the new boxes show where they land.
export function holdView(
  prev: Layout,
  next: Layout,
  top: number,
  size: Size = WIDE,
): number {
  if (top < size.row / 2) return 0;
  let held: Placed | null = null;
  for (const p of prev.nodes.values())
    if (p.y + size.h > top && next.nodes.has(p.id) && (!held || p.y < held.y))
      held = p;
  return held ? next.nodes.get(held.id)!.y - held.y : 0;
}
