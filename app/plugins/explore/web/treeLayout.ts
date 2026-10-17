// Explore's Tree, laid out to use the screen's width: the question on top,
// its options (or causes, or sub-questions) side by side under it, wrapped
// into rows past `maxW`, and everything under each one stacked down its own
// column, indented by depth. A question anywhere below lays its own options
// across under it the same way, so a sub-choice's options no longer made one
// tall column under its cause. The facts and checks on a question itself
// stack in one column at the end of its first row, where a cause growing
// longer never moves them. Laid left to right, as it first was, a cause list
// with its checks made one tall column: at a readable zoom the root and half
// the causes were off the screen. A set-aside or settled branch folds to its
// own card unless you open it. Every card keeps its place when one is set
// aside (it used to move to the end, and the camera, following it, threw the
// rest of the tree off the screen). Pure: no React, no browser, so it is
// tested (explore.test.ts), and Learn's layout is not touched.

import type { MapNode } from "../../../shared/model.ts";
import { NODE_W } from "../../../web/lib/layout.ts";

export const CARD_W = NODE_W;
const INDENT = 24; // per level down a column
const INDENT_LEVELS = 2; // deeper still is drawn at the last indent
// a column's width whatever is in it: a column growing deeper used to widen
// and push every column to its right
export const SLOT = CARD_W + INDENT * INDENT_LEVELS;
const GAP_X = 32; // between columns
const GAP_Y = 10; // between cards down a column
const RANK = 56; // from a question to the row under it
const ROW_GAP = 48; // between wrapped rows
const BLOCK_GAP = 80; // between separate trees (a node whose parent is gone)
// a question below the root wraps its options two to a row: laid all
// across, a sub-choice's column was as wide as the screen, and the causes
// beside it wrapped into a row below, out of the frame
const NESTED_W = 2 * SLOT + GAP_X;
// a column under such a question: a card and one level of checks
const NARROW = CARD_W + INDENT;
// where the spine down a column leaves a card: near its left edge, so the
// line runs beside the cards under it, not through them
export const SPINE = 12;

export type Box = { x: number; y: number; w: number; h: number };

export type TreeEdge = {
  id: string;
  source: string;
  target: string;
  // "row": from a question down to an option's top; "column": down the
  // spine and into a card's left side; "stack": from a question along its
  // bus, then down its notes' spine into a card's left side
  kind: "row" | "column" | "stack";
  // the bus line under the question; for a wrapped row the trunk on the
  // left down to that row's own bus; for a stack, its spine
  bus?: number;
  trunk?: number;
  rowBus?: number;
  spine?: number;
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

// what a question's first row leads with: what is in play (options, or
// causes), then the questions under it; anything else is a note on the
// question, stacked beside the row
const rank = (n: MapNode) =>
  n.kind === "option" ? 0 : n.kind === "question" ? 1 : 2;

export function treeLayout(
  nodes: MapNode[],
  {
    maxW,
    heightOf,
    folds = () => false,
  }: {
    // how wide a row may run before it wraps, in layout units
    maxW: number;
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
  const folded: Record<string, number> = {};
  const open = (n: MapNode) => {
    if (!childrenOf(n.id).length) return [];
    if (!folds(n)) return childrenOf(n.id);
    folded[n.id] = under(n.id);
    return [];
  };

  // A card and what is under it, laid out at (0, 0): its cards and its
  // lines, moved into place as a whole once its parent knows where.
  type Block = { ids: string[]; edges: TreeEdge[]; w: number; h: number };
  const shift = (b: Block, dx: number, dy: number) => {
    for (const id of b.ids) {
      boxes[id].x += dx;
      boxes[id].y += dy;
    }
    for (const e of b.edges) {
      if (e.bus !== undefined) e.bus += dy;
      if (e.rowBus !== undefined) e.rowBus += dy;
      if (e.trunk !== undefined) e.trunk += dx;
      if (e.spine !== undefined) e.spine += dx;
    }
  };
  const put = (into: Block, b: Block, dx: number, dy: number) => {
    shift(b, dx, dy);
    into.ids.push(...b.ids);
    into.edges.push(...b.edges);
  };
  const card = (n: MapNode, x: number): Block => {
    const h = heightOf(n);
    boxes[n.id] = { x, y: 0, w: CARD_W, h };
    return { ids: [n.id], edges: [], w: x + CARD_W, h };
  };
  const indent = (level: number) => INDENT * Math.min(level, INDENT_LEVELS);
  // `budget`: how wide a question in it may lay its row; `slot`: the least
  // width of a column in a row (see question)
  const blockOf = (
    n: MapNode,
    level: number,
    budget: number,
    slot: number,
  ): Block =>
    n.kind === "question" && open(n).length
      ? question(n, false, budget)
      : column(n, level, budget, slot);

  // A card with what is under it stacked below, indented a level; a
  // question under it lays its own row.
  const column = (
    n: MapNode,
    level: number,
    budget: number,
    slot: number,
  ): Block => {
    const b = card(n, indent(level));
    let y = b.h + GAP_Y;
    for (const c of open(n)) {
      b.edges.push({
        id: `${n.id}-${c.id}`,
        source: n.id,
        target: c.id,
        kind: "column",
      });
      const dx =
        c.kind === "question" && open(c).length ? indent(level + 1) : 0;
      const sub = blockOf(c, level + 1, budget - dx, slot);
      put(b, sub, dx, y);
      b.w = Math.max(b.w, dx + sub.w);
      y += sub.h + GAP_Y;
    }
    b.h = y - GAP_Y;
    if (level === 0) b.w = Math.max(b.w, slot);
    return b;
  };

  // A question with its options side by side under it, wrapped into rows
  // past `budget`, and its notes stacked at the end of the first row. The root
  // is centred over them; a question below sits at its block's left, where
  // the column it is in comes down to it. The root's columns take a full
  // slot each, so one growing deeper moves no other; a question below takes
  // its columns narrower, and when the one it is in would wrap onto a row
  // below the frame, it lays its row narrower still to stay on the first.
  const question = (q: MapNode, centred: boolean, budget: number): Block => {
    const b = card(q, 0);
    const th = b.h;
    const all = open(q);
    const inRow = all
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => rank(n) < 2)
      .sort((a, c) => rank(a.n) - rank(c.n) || a.i - c.i)
      .map(({ n }) => n);
    const slot = centred ? SLOT : NARROW;
    const notes = all.filter((n) => rank(n) === 2);
    let stack: (Block & { heads: string[] }) | null = null;
    if (notes.length) {
      stack = { ids: [], edges: [], w: SLOT, h: 0, heads: [] };
      let y = 0;
      for (const n of notes) {
        const sub = column(n, 1, NESTED_W, SLOT);
        put(stack, sub, 0, y);
        stack.w = Math.max(stack.w, sub.w);
        stack.heads.push(n.id);
        y += sub.h + GAP_Y;
      }
      stack.h = y - GAP_Y;
    }
    // the first row keeps room for the notes, so they never wrap below
    type Item = { head: MapNode; block: Block };
    const rows: Item[][] = [];
    let row: Item[] = [];
    let rowW = 0;
    for (const head of inRow) {
      const room = budget - (rows.length === 0 && stack ? stack.w + GAP_X : 0);
      const free = room - rowW - (row.length ? GAP_X : 0);
      let block = blockOf(head, 0, NESTED_W, slot);
      // too wide for what is left of the row only for a question laid in
      // it: laid narrower, it may still fit (laying it again sets its
      // cards anew)
      if (row.length && block.w > free) {
        const narrow = blockOf(head, 0, free, slot);
        block = narrow.w <= free ? narrow : blockOf(head, 0, NESTED_W, slot);
      }
      const c = { head, block };
      const w = rowW + (row.length ? GAP_X : 0) + c.block.w;
      if (row.length && w > room) {
        rows.push(row);
        row = [];
        rowW = 0;
      }
      rowW += (row.length ? GAP_X : 0) + c.block.w;
      row.push(c);
    }
    if (row.length || stack) rows.push(row);
    const bus = th + RANK / 2;
    let y = th + RANK;
    let width = CARD_W;
    rows.forEach((r, k) => {
      let x = 0;
      let tallest = 0;
      const wrapped =
        k > 0 ? { trunk: -GAP_X / 2, rowBus: y - ROW_GAP / 2 } : {};
      for (const c of r) {
        put(b, c.block, x, y);
        b.edges.push({
          id: `${q.id}-${c.head.id}`,
          source: q.id,
          target: c.head.id,
          kind: "row",
          bus,
          ...wrapped,
        });
        x += c.block.w + GAP_X;
        tallest = Math.max(tallest, c.block.h);
      }
      if (k === 0 && stack) {
        for (const id of stack.heads)
          b.edges.push({
            id: `${q.id}-${id}`,
            source: q.id,
            target: id,
            kind: "stack",
            bus,
            spine: x + SPINE,
          });
        put(b, stack, x, y);
        x += stack.w + GAP_X;
        tallest = Math.max(tallest, stack.h);
      }
      width = Math.max(width, x - GAP_X);
      y += tallest + ROW_GAP;
    });
    b.w = width;
    b.h = rows.length ? y - ROW_GAP : th;
    if (centred) boxes[q.id].x = (width - CARD_W) / 2;
    return b;
  };

  const edges: TreeEdge[] = [];
  let left = 0;
  const root = tops[0]?.id ?? null;
  for (const top of tops) {
    const b =
      top.kind === "question"
        ? question(top, true, maxW)
        : column(top, 0, NESTED_W, SLOT);
    shift(b, left, 0);
    edges.push(...b.edges);
    left += b.w + BLOCK_GAP;
  }
  const heads = edges
    .filter((e) => e.source === root && e.kind !== "column")
    .map((e) => e.target);
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
