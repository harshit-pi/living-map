// Explore's Tree, laid out to use the screen's width: the question on top,
// its options (or causes, or sub-questions) side by side under it, wrapped
// into rows past `perRow`, and everything under each one stacked down its
// own column, indented by depth. Laid left to right, as it was, a cause list
// with its checks made one tall column: at a readable zoom the root and half
// the causes were off the screen. A set-aside or settled branch folds to its
// own card unless you open it. Pure: no React, no browser, so it is tested
// (explore.test.ts), and Learn's layout is not touched.

import type { MapNode } from "../../../shared/model.ts";
import { NODE_W } from "../../../web/lib/layout.ts";

export const CARD_W = NODE_W;
const INDENT = 24; // per level down a column
const INDENT_LEVELS = 3; // deeper still is drawn at the last indent
const GAP_X = 32; // between columns
const GAP_Y = 10; // between cards down a column
const RANK = 56; // from the question to the row under it
const ROW_GAP = 48; // between wrapped rows
const BLOCK_GAP = 80; // between separate trees (a node whose parent is gone)
// where the spine down a column leaves a card: near its left edge, so the
// line runs beside the cards under it, not through them
export const SPINE = 12;

export type Box = { x: number; y: number; w: number; h: number };

export type TreeEdge = {
  id: string;
  source: string;
  target: string;
  // "row": from the question down to an option's top; "column": down the
  // spine and into a card's left side
  kind: "row" | "column";
  // a row edge: the bus line under the question, and for a wrapped row the
  // trunk on the left down to that row's own bus
  bus?: number;
  trunk?: number;
  rowBus?: number;
};

export type TreeLayout = {
  boxes: Record<string, Box>;
  edges: TreeEdge[];
  // a folded card: how many cards are under it
  folded: Record<string, number>;
  // the first tree's question, and the cards right under it
  root: string | null;
  heads: string[];
};

export function treeLayout(
  nodes: MapNode[],
  {
    perRow,
    heightOf,
    folds = () => false,
  }: {
    perRow: number;
    heightOf: (n: MapNode) => number;
    // whether what is under this card folds into it
    folds?: (n: MapNode) => boolean;
  },
): TreeLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, MapNode[]>();
  for (const n of nodes)
    if (n.parent && byId.has(n.parent))
      kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  for (const list of kids.values()) list.sort((a, b) => a.order - b.order);
  const childrenOf = (id: string) => kids.get(id) ?? [];
  const under = (id: string): number =>
    childrenOf(id).reduce((a, c) => a + 1 + under(c.id), 0);
  // the question first, then anything left without its parent
  const tops = nodes
    .filter((n) => !n.parent || !byId.has(n.parent))
    .sort(
      (a, b) => Number(!!a.parent) - Number(!!b.parent) || a.order - b.order,
    );

  const boxes: Record<string, Box> = {};
  const edges: TreeEdge[] = [];
  const folded: Record<string, number> = {};
  const open = (n: MapNode) => {
    if (!childrenOf(n.id).length) return [];
    if (!folds(n)) return childrenOf(n.id);
    folded[n.id] = under(n.id);
    return [];
  };

  // One column: a card and all under it, stacked, at (0, 0); returns its
  // size. Positions are moved into place once the row is known.
  type Col = { ids: string[]; w: number; h: number };
  const column = (head: MapNode): Col => {
    const ids: string[] = [];
    let y = 0;
    let deepest = 0;
    const walk = (n: MapNode, level: number) => {
      const x = INDENT * Math.min(level, INDENT_LEVELS);
      deepest = Math.max(deepest, Math.min(level, INDENT_LEVELS));
      const h = heightOf(n);
      boxes[n.id] = { x, y, w: CARD_W, h };
      ids.push(n.id);
      y += h + GAP_Y;
      for (const c of open(n)) {
        edges.push({
          id: `${n.id}-${c.id}`,
          source: n.id,
          target: c.id,
          kind: "column",
        });
        walk(c, level + 1);
      }
    };
    walk(head, 0);
    return { ids, w: CARD_W + INDENT * deepest, h: y - GAP_Y };
  };
  const shift = (ids: string[], dx: number, dy: number) => {
    for (const id of ids) {
      boxes[id].x += dx;
      boxes[id].y += dy;
    }
  };

  let left = 0;
  let root: string | null = null;
  let heads: string[] = [];
  for (const top of tops) {
    const th = heightOf(top);
    // what is in play leads the first row (the options, or causes), then
    // the questions under it, then facts and checks, and what was set aside
    // last: when the row wraps, the work still open is what stays on top
    const rank = (n: MapNode) =>
      n.dropped || n.status === "dropped"
        ? 3
        : n.kind === "option"
          ? 0
          : n.kind === "question"
            ? 1
            : 2;
    const cols = open(top)
      .map((h, i) => ({ h, i }))
      .sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i)
      .map(({ h }) => ({ head: h, ...column(h) }));
    const rows: (typeof cols)[] = [];
    for (let i = 0; i < cols.length; i += Math.max(1, perRow))
      rows.push(cols.slice(i, i + Math.max(1, perRow)));
    const rowW = (r: typeof cols) =>
      r.reduce((a, c) => a + c.w, 0) + GAP_X * (r.length - 1);
    const width = Math.max(CARD_W, ...rows.map(rowW));
    // the question centred over the widest row
    boxes[top.id] = { x: left + (width - CARD_W) / 2, y: 0, w: CARD_W, h: th };
    const bus = th + RANK / 2;
    const trunk = left - GAP_X / 2;
    let y = th + RANK;
    rows.forEach((r, k) => {
      let x = left + (width - rowW(r)) / 2;
      for (const c of r) {
        shift(c.ids, x, y);
        edges.push({
          id: `${top.id}-${c.head.id}`,
          source: top.id,
          target: c.head.id,
          kind: "row",
          bus,
          ...(k > 0 ? { trunk, rowBus: y - ROW_GAP / 2 } : {}),
        });
        x += c.w + GAP_X;
      }
      y += Math.max(...r.map((c) => c.h)) + ROW_GAP;
    });
    if (root === null) {
      root = top.id;
      heads = cols.map((c) => c.head.id);
    }
    left += width + BLOCK_GAP;
  }
  return { boxes, edges, folded, root, heads };
}

// The box around some cards.
export function boundsOf(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: b - y };
}

// Where the camera goes on first open and from the fit button: the whole
// tree centred when it can be read whole; else the question and the cards
// right under it, as large as fits (never under `readable`), from the top
// of the room, so each column runs on down for you to pan to; and when even
// they are too wide, centred on the question.
export function frameOf(
  layout: TreeLayout,
  room: { left: number; top: number; w: number; h: number },
  { readable = 0.7, max = 1 } = {},
): { x: number; y: number; zoom: number } {
  const all = boundsOf(Object.values(layout.boxes));
  if (!all.w || !all.h) return { x: room.left, y: room.top, zoom: max };
  const whole = Math.min(max, room.w / all.w, room.h / all.h);
  if (whole >= readable)
    return {
      zoom: whole,
      x: room.left + (room.w - all.w * whole) / 2 - all.x * whole,
      y: room.top + (room.h - all.h * whole) / 2 - all.y * whole,
    };
  const ids = [layout.root, ...layout.heads].filter(
    (id): id is string => !!id && !!layout.boxes[id],
  );
  const near = boundsOf(ids.map((id) => layout.boxes[id]));
  const zoom = Math.max(
    readable,
    Math.min(max, room.w / near.w, room.h / near.h),
  );
  const q = layout.root ? layout.boxes[layout.root] : near;
  const x =
    near.w * zoom <= room.w
      ? room.left + (room.w - near.w * zoom) / 2 - near.x * zoom
      : room.left + room.w / 2 - (q.x + q.w / 2) * zoom;
  return { zoom, x, y: room.top - near.y * zoom };
}
