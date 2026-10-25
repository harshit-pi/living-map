// The mind map's layout: a tree growing left to right from the chat's root.
// A node's column is its depth; its row is the next free row when it is
// reached in order, and a parent shares the row of its first child. Rows
// are given out in tree order (siblings by their order key), so an item
// appended under a parent takes the row after that parent's last row: every
// node on an earlier row keeps its place, and the rows after it move down by
// whole rows. No measuring and no graph layout library: positions follow
// from the items alone, so the same items always land in the same places.

import type { LedgerItem } from "../../shared/ledger.ts";

export const COL = 260; // px between columns
export const ROW = 60; // px between rows
export const NODE_W = 224;
export const NODE_H = 46;
export const ROOT = "root"; // the chat itself, left of every topic

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

// each item's children, sorted; an item whose parent is gone hangs off the root
export function childrenMap(items: LedgerItem[]): Map<string, LedgerItem[]> {
  const ids = new Set(items.map((i) => i.id));
  const kids = new Map<string, LedgerItem[]>();
  for (const i of items) {
    const p = i.parent && ids.has(i.parent) ? i.parent : ROOT;
    const list = kids.get(p) ?? [];
    list.push(i);
    kids.set(p, list);
  }
  for (const list of kids.values()) list.sort(byOrder);
  return kids;
}

export function layout(
  items: LedgerItem[],
  folded: (id: string) => boolean = () => false,
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
      x: depth * COL,
      y: first * ROW,
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
