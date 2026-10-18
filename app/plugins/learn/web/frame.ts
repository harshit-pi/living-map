// Where things sit on the build canvas: the frame drawn as a background
// (lanes, a time axis, boxes, sort columns), which slot a spot falls in, the
// next free spot for a part, and Tidy. Pure: the canvas draws what this says.

import dagre from "@dagrejs/dagre";

import type { Frame } from "../shared.ts";

export const NODE_W = 172;
export const NODE_H = 62;
const GAP = 22;
// parts one after another along a lane or down a column leave room for the
// verb on the link between them (at 22px a label sat on the cards)
const ALONG_X = NODE_W + 96;
const ALONG_Y = NODE_H + 46;
const LANE_H = 130;
const LANE_LABEL = 120;
// a column holds a card with a few pixels each side: at 200 a six-tick axis
// and its waiting zone opened at half size, the words about 6px
const COL_W = 190;
const BOX_W = 440;
// a box's spots, across and down (boxSpot)
const BOX_DX = NODE_W + 60;
const BOX_DY = NODE_H + 40;
// boxes two to a row: three made the frame so wide the canvas opened at half size
const BOX_ROW = 2;
const TOP = 44;

export type At = { x: number; y: number };
export type Region = {
  slot: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // a lane's parts to a row (laneSpot)
  per?: number;
};

// lanes run across, so a lane is a band of height; the axis and sort columns
// run down; boxes are rectangles, two to a row
const across = (f: Frame) => f.kind === "lanes";
const down = (f: Frame) => f.kind === "axis" || f.kind === "sort";

// the rows of two a box needs for `n` parts, two at least, and its height
// then: a fixed box held three rows, and a fourth part was drawn under it
// while the check counted it in; a box 300 tall whatever it held made three
// boxes of eight parts so tall that a review, with the tray beside it,
// opened at 0.57 and the names were 7px
const boxRows = (n: number) => Math.max(2, Math.ceil(n / 2));
const boxHeight = (n: number) => 36 + boxRows(n) * BOX_DY - 40 + 16;

// a column's height for parts stacked `rows` deep, from its top spot
const colHeight = (rows: number) =>
  8 + (Math.max(1, rows) - 1) * ALONG_Y + NODE_H + 24;

// A lane holds its parts on spots in rows of two or three, as many as its
// share of the step's parts. Drawn where each was dropped, a lane ran as
// wide as its farthest part: a lane step opened at 0.55 with 7px words, and
// the frame grew and moved with each drop.
const lanePer = (lanes: number, n: number) =>
  Math.min(3, Math.max(2, Math.ceil(n / Math.max(1, lanes))));
const laneH = (rows: number) => LANE_H - 8 + (Math.max(1, rows) - 1) * ALONG_Y;

// The frame's slots on the canvas, sized to hold what is on it (`span`: the
// most parts in one slot; for columns, how far down they reach). `n`: every
// part of the step: a column or a lane starts big enough for its share of
// them, so it does not grow (and move the waiting zone under it) as they
// arrive; at 420 deep, five mostly empty ticks made the frame twice the
// height it needed.
export function regions(frame: Frame, span = 0, n = 0): Region[] {
  switch (frame.kind) {
    case "lanes": {
      const lanes = frame.lanes.length;
      const per = lanePer(lanes, n);
      const share = Math.ceil(n / Math.max(1, lanes));
      const rows = Math.ceil(Math.max(1, share, span) / per);
      const w = Math.max(640, 16 + (per - 1) * ALONG_X + NODE_W + 40);
      const h = laneH(rows);
      return frame.lanes.map((l, i) => ({
        slot: l,
        label: l,
        x: -LANE_LABEL,
        y: i * (h + 8),
        w: w + LANE_LABEL,
        h,
        per,
      }));
    }
    case "axis":
    case "sort": {
      const cols = frame.kind === "axis" ? frame.ticks : frame.columns;
      const rows = Math.max(2, Math.ceil(n / Math.max(1, cols.length)));
      const h = Math.max(colHeight(rows), span + NODE_H + 24);
      return cols.map((c, i) => ({
        slot: c,
        label: c,
        x: i * COL_W,
        y: -TOP,
        w: COL_W - 12,
        h: h + TOP,
      }));
    }
    case "boxes": {
      // sized for its share of the parts, as a lane is, so a drop into it
      // grows it only past that
      const share = Math.ceil(n / Math.max(1, frame.boxes.length));
      const h = boxHeight(Math.max(span, share));
      return frame.boxes.map((b, i) => ({
        slot: b.id,
        label: b.label,
        x: (i % BOX_ROW) * (BOX_W + 40),
        y: Math.floor(i / BOX_ROW) * (h + 40),
        w: BOX_W,
        h,
      }));
    }
    default:
      return [];
  }
}

// how far the parts reach, so the frame grows to hold them: down a column,
// its lowest spot (parts stack on spots); for lanes and boxes, the most
// parts in one
export function spanOf(frame: Frame, at: (At & { slot?: string })[]): number {
  const n = new Map<string, number>();
  for (const p of at) if (p.slot) n.set(p.slot, (n.get(p.slot) ?? 0) + 1);
  const most = Math.max(0, ...n.values());
  if (down(frame)) return most ? 8 + (most - 1) * ALONG_Y : 0;
  if (frame.kind === "boxes" || across(frame)) return most;
  return 0;
}

const centre = (p: At): At => ({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 });

// a column ends at its bottom: the waiting zone is under it
const inside = (r: Region, frame: Frame, p: At) => {
  const c = centre(p);
  if (across(frame)) return c.y >= r.y && c.y < r.y + r.h + 8;
  if (down(frame))
    return c.x >= r.x && c.x < r.x + r.w + 12 && c.y < r.y + r.h + 12;
  return c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;
};

// The slot a part dropped at `p` lands in, or null outside every slot.
export function slotAt(frame: Frame, p: At, span = 0, n = 0): string | null {
  return regions(frame, span, n).find((r) => inside(r, frame, p))?.slot ?? null;
}

// Where the parts outside the frame wait: under the frame, every kind (right
// of six ticks, the zone made the axis too wide to read at 1440). A framed
// canvas draws a part with no slot there, never inside a slot it is not in,
// so the picture reads as the check does. `label`: the worked case keeps its
// hidden part here, where its slot would point at the answer. `n`: every
// part of the step, which the frame is sized for; `hold`: the most parts
// that can wait here (all of them, while you build): the zone is sized for
// them from the start, in rows that wrap inside the frame, so placing one
// never grows the canvas (it grew a card wider each time, the view refit,
// and the next drop target moved).
export function looseZone(
  frame: Frame,
  span = 0,
  label?: string,
  n = 1,
  hold = n,
): Region | null {
  const rs = regions(frame, span, n);
  if (!rs.length) return null;
  const bottom = Math.max(...rs.map((r) => r.y + r.h)) + 30;
  const w = Math.max(...rs.map((r) => r.x + r.w)) - rs[0].x;
  const rows = Math.ceil(Math.max(1, hold) / perLine(w - 14, NODE_W));
  return {
    slot: "",
    label:
      label ??
      (across(frame)
        ? "Not in a lane yet"
        : down(frame)
          ? "Not in a column yet"
          : "Not in a box yet"),
    x: rs[0].x,
    y: bottom,
    w,
    h: 34 + rows * (NODE_H + GAP) - GAP + 18,
  };
}

// how many cards of size `card` fit along a length
const perLine = (len: number, card: number) =>
  Math.max(1, Math.floor((len + GAP) / (card + GAP)));

// The i-th spot in the waiting zone: across, then down.
const looseSpot = (z: Region, i: number): At => {
  const per = perLine(z.w - 14, NODE_W);
  return {
    x: z.x + 14 + (i % per) * (NODE_W + GAP),
    y: z.y + 34 + Math.floor(i / per) * (NODE_H + GAP),
  };
};

// a spot inside a box: two parts to a row, under its label, with room
// between them for a link's line beside its label (at 40 across and 22 down,
// the links between neighbours had to arc round and their labels met)
const boxSpot = (r: Region, k: number): At => ({
  x: r.x + 14 + (k % 2) * BOX_DX,
  y: r.y + 36 + Math.floor(k / 2) * BOX_DY,
});

// Where each placed part is drawn. On a free map, where it is. On a frame,
// on its lane's, column's or box's spots, in the order they came into it (a
// part at the box's corner sat on "CONGRESS"; sorted by where each was
// dropped, a new part went to the top of its box and moved the ones in it),
// and in the waiting zone when it has no slot, on a spot of its own: its
// place among the parts placed, so taking one out of the zone moves no other
// (they moved up a spot after each drop, under the pointer). `n`: every
// part of the step, which the frame and the waiting zone are sized for.
export function drawn(
  frame: Frame,
  placed: (At & { id: string; slot?: string; n?: number })[],
  n = placed.length,
): Record<string, At> {
  const span = spanOf(
    frame,
    placed.filter((p) => p.slot),
  );
  const rs = regions(frame, span, n);
  const out: Record<string, At> = {};
  if (!rs.length) {
    for (const p of placed) out[p.id] = { x: p.x, y: p.y };
    return out;
  }
  const z = looseZone(frame, span, undefined, n)!;
  placed.forEach((p, i) => {
    if (!p.slot || !rs.some((x) => x.slot === p.slot))
      out[p.id] = looseSpot(z, i);
  });
  // in a slot, its parts sit on its spots in the order they came into it
  // (a part's `n`; parts placed before it had one, by height, then across):
  // kept where they were dropped, one hung off the bottom of its box while
  // the check counted it in, a drop low in a column made the column taller
  // and moved the zone under it
  for (const r of rs)
    placed
      .filter((p) => p.slot === r.slot)
      .sort((a, b) => (a.n ?? 0) - (b.n ?? 0) || a.y - b.y || a.x - b.x)
      .forEach((p, k) => {
        out[p.id] = spotOf(frame, r, k);
      });
  return out;
}

// the k-th spot of a slot: along a lane, row by row; down a column; across
// a box, two to a row. In a lane a part sits on its row's middle line: one
// a little off it drew its links slanted.
function spotOf(frame: Frame, r: Region, k: number): At {
  if (across(frame)) {
    const per = r.per ?? 3;
    return {
      x: 16 + (k % per) * ALONG_X,
      y: r.y + (LANE_H - 8 - NODE_H) / 2 + Math.floor(k / per) * ALONG_Y,
    };
  }
  return down(frame) ? colSpot(r, k) : boxSpot(r, k);
}

// the k-th spot down a column
const colSpot = (r: Region, k: number): At => ({
  x: r.x + (r.w - NODE_W) / 2,
  y: 8 + k * ALONG_Y,
});

const clear = (taken: At[], p: At) =>
  taken.every(
    (t) =>
      Math.abs(t.x - p.x) > NODE_W + GAP / 2 ||
      Math.abs(t.y - p.y) > NODE_H + GAP / 2,
  );

// The next free spot in a slot: along a lane, down a column, across a box.
export function spotIn(frame: Frame, r: Region, taken: At[]): At {
  for (let k = 0; k < 40; k++) {
    const p = spotOf(frame, r, k);
    if (clear(taken, p)) return p;
  }
  return { x: r.x + 14, y: r.y + 36 };
}

// Where a part goes when you click it in the tray. On a time axis, the first
// tick with nothing on it, so clicking the parts in order lays them out in
// order. In lanes, boxes and sort columns, which slot a part belongs in is
// part of what you are building, so it waits outside the frame for you to
// drag it in. On a free map, the next free spot on a grid.
// `n`: every part of the step, which the waiting zone is sized for.
export function nextSpot(
  frame: Frame,
  placed: (At & { slot?: string })[],
  n = placed.length + 1,
): At & { slot?: string } {
  const span = spanOf(
    frame,
    placed.filter((p) => p.slot),
  );
  const rs = regions(frame, span, n);
  if (frame.kind === "axis") {
    const r = rs.find((x) => !placed.some((p) => p.slot === x.slot));
    if (r) return { ...spotIn(frame, r, placed), slot: r.slot };
  }
  // the zone's spot drawn holds it: its place among the parts placed
  if (rs.length)
    return looseSpot(looseZone(frame, span, undefined, n)!, placed.length);
  for (let k = 0; k < 60; k++) {
    const p = { x: (k % 3) * (NODE_W + 48), y: Math.floor(k / 3) * 110 };
    if (clear(placed, p)) return p;
  }
  return { x: 0, y: placed.length * 110 };
}

type Laid = { id: string; slot?: string };

const PER_ROW = 4;
const RANK = 96;

// A long chain laid left to right runs off a wide screen at a size nobody
// can read: past four columns it folds into rows of four, each row running
// back the other way, so the link that wraps to the next row is short.
function fold(at: Record<string, At>): Record<string, At> {
  const xs = [...new Set(Object.values(at).map((p) => p.x))].sort(
    (a, b) => a - b,
  );
  if (xs.length <= PER_ROW) return at;
  const ys = Object.values(at).map((p) => p.y);
  const top = Math.min(...ys);
  const tall = Math.max(...ys) - top + NODE_H + 70;
  const out: Record<string, At> = {};
  for (const [id, p] of Object.entries(at)) {
    const col = xs.indexOf(p.x);
    const row = Math.floor(col / PER_ROW);
    const at = row % 2 ? PER_ROW - 1 - (col % PER_ROW) : col % PER_ROW;
    out[id] = {
      x: at * (NODE_W + RANK),
      y: p.y - top + row * tall,
    };
  }
  return out;
}

// Tidy, and the worked case's layout: the links laid left to right (dagre),
// then each part kept in its slot: a lane holds its parts in a row, a column
// or a box stacks them. Parts with no slot on a framed canvas wait in a row
// under the frame.
export function tidy(
  frame: Frame,
  parts: Laid[],
  links: { from: string; to: string }[],
): Record<string, At> {
  const g = new dagre.graphlib.Graph();
  // room between ranks for a verb's label: at 70 it lay on both cards
  g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: RANK });
  g.setDefaultEdgeLabel(() => ({}));
  for (const p of parts) g.setNode(p.id, { width: NODE_W, height: NODE_H });
  for (const l of links)
    if (g.hasNode(l.from) && g.hasNode(l.to)) g.setEdge(l.from, l.to);
  dagre.layout(g);
  const free: Record<string, At> = {};
  for (const p of parts) {
    const n = g.node(p.id);
    free[p.id] = {
      x: Math.round(n.x - NODE_W / 2),
      y: Math.round(n.y - NODE_H / 2),
    };
  }
  // a box is as tall as the most parts one box holds, a column as deep, a
  // lane as many rows
  const rs = regions(
    frame,
    spanOf(
      frame,
      parts.map((p) => ({ x: 0, y: 0, slot: p.slot })),
    ),
    parts.length,
  );
  if (!rs.length) return fold(free);
  const out: Record<string, At> = {};
  const loose: Laid[] = [];
  // the order dagre gave them, along the frame's own direction
  const along = (p: Laid) => (across(frame) ? free[p.id].x : free[p.id].y);
  for (const r of rs) {
    const here = parts
      .filter((p) => p.slot === r.slot)
      .sort((a, b) => along(a) - along(b));
    const taken: At[] = [];
    for (const p of here) {
      const at = spotIn(frame, r, taken);
      taken.push(at);
      out[p.id] = at;
    }
  }
  for (const p of parts) if (!(p.id in out)) loose.push(p);
  const span = spanOf(
    frame,
    parts
      .filter((p) => p.id in out)
      .map((p) => ({ ...out[p.id], slot: p.slot })),
  );
  const z = looseZone(frame, span, undefined, parts.length, loose.length)!;
  loose
    .sort((a, b) => free[a.id].x - free[b.id].x)
    .forEach((p, i) => {
      out[p.id] = looseSpot(z, i);
    });
  return out;
}

// ---------------------------------------------------------------- links

export type Side = "top" | "right" | "bottom" | "left";
// how a link is drawn: straight between two sides; as an arc that leaves
// and enters on one side, that far out; or as an elbow from one side to the
// side facing it, turning between them (through the gap between rows or
// columns: between diagonal neighbours every straight line and arc ran
// through a part), half way or `mid` of the way, so two in one gap run side
// by side; `at`: where along its line (or the arc's outer run, the elbow's
// middle run) its label sits, half way when not said. A detour, when
// every one of those runs through a part: out of one side a little way, to
// a run along the gap between rows (`axis` "y", at `via`) or columns ("x"),
// and in by a side of the other; between two boxes stacked in a box, every
// line out of the upper one ran down through the lower one and read as
// starting from it.
export type Route = (
  | { type: "straight"; source: Side; target: Side }
  | { type: "arc"; side: Side; offset: number }
  | { type: "elbow"; source: Side; target: Side; mid?: number }
  | { type: "detour"; source: Side; target: Side; axis: "x" | "y"; via: number }
) & { at?: number };

const LABEL_H = 18;
// a label's width at the canvas's own scale (11px type)
export const labelWidth = (text: string) => text.length * 6.3 + 14;

const handleAt = (p: At, side: Side): At =>
  side === "top"
    ? { x: p.x + NODE_W / 2, y: p.y }
    : side === "bottom"
      ? { x: p.x + NODE_W / 2, y: p.y + NODE_H }
      : side === "left"
        ? { x: p.x, y: p.y + NODE_H / 2 }
        : { x: p.x + NODE_W, y: p.y + NODE_H / 2 };

// how far a detour runs out of a side before it turns
const OUT = 16;
const outOf = (p: At, side: Side): At =>
  side === "top"
    ? { x: p.x, y: p.y - OUT }
    : side === "bottom"
      ? { x: p.x, y: p.y + OUT }
      : side === "left"
        ? { x: p.x - OUT, y: p.y }
        : { x: p.x + OUT, y: p.y };

// the sides a straight link leaves and enters by: across when the parts sit
// side by side, down when one is above the other
export function facing(a: At, b: At): [Side, Side] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy) * 1.4)
    return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

// The line a route draws, and where its label sits. The canvas draws this
// line itself (BuildCanvas's routed edge), so what is costed here is what is
// on screen.
export function pathOf(a: At, b: At, r: Route): { pts: At[]; label: At } {
  const f = r.at ?? 0.5;
  const on = (p: At, q: At): At => ({
    x: p.x + (q.x - p.x) * f,
    y: p.y + (q.y - p.y) * f,
  });
  if (r.type === "straight") {
    const s = handleAt(a, r.source);
    const t = handleAt(b, r.target);
    return { pts: [s, t], label: on(s, t) };
  }
  if (r.type === "elbow") {
    const s = handleAt(a, r.source);
    const t = handleAt(b, r.target);
    const k = r.mid ?? 0.5;
    const my = s.y + (t.y - s.y) * k;
    const mx = s.x + (t.x - s.x) * k;
    const [p, q] =
      r.source === "top" || r.source === "bottom"
        ? [
            { x: s.x, y: my },
            { x: t.x, y: my },
          ]
        : [
            { x: mx, y: s.y },
            { x: mx, y: t.y },
          ];
    return { pts: [s, p, q, t], label: on(p, q) };
  }
  if (r.type === "detour") {
    const s = handleAt(a, r.source);
    const t = handleAt(b, r.target);
    const s1 = outOf(s, r.source);
    const t1 = outOf(t, r.target);
    const [p, q] =
      r.axis === "y"
        ? [
            { x: s1.x, y: r.via },
            { x: t1.x, y: r.via },
          ]
        : [
            { x: r.via, y: s1.y },
            { x: r.via, y: t1.y },
          ];
    return { pts: [s, s1, p, q, t1, t], label: on(p, q) };
  }
  const s = handleAt(a, r.side);
  const t = handleAt(b, r.side);
  const o = r.offset;
  if (r.side === "top" || r.side === "bottom") {
    const y =
      r.side === "bottom" ? Math.max(s.y, t.y) + o : Math.min(s.y, t.y) - o;
    const p = { x: s.x, y };
    const q = { x: t.x, y };
    return { pts: [s, p, q, t], label: on(p, q) };
  }
  const x =
    r.side === "right" ? Math.max(s.x, t.x) + o : Math.min(s.x, t.x) - o;
  const p = { x, y: s.y };
  const q = { x, y: t.y };
  return { pts: [s, p, q, t], label: on(p, q) };
}

// The SVG path of a route's line, its bends rounded a little.
export function pathD(pts: At[]): string {
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const next = pts[i + 1];
    if (!next) {
      d += ` L ${p.x},${p.y}`;
      break;
    }
    const prev = pts[i - 1];
    const r = Math.min(
      8,
      Math.hypot(p.x - prev.x, p.y - prev.y) / 2,
      Math.hypot(next.x - p.x, next.y - p.y) / 2,
    );
    const towards = (q: At, k: number) => {
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return {
        x: p.x + ((q.x - p.x) / len) * k,
        y: p.y + ((q.y - p.y) / len) * k,
      };
    };
    const a = towards(prev, r);
    const b = towards(next, r);
    d += ` L ${a.x},${a.y} Q ${p.x},${p.y} ${b.x},${b.y}`;
  }
  return d;
}

const hits = (p: At, q: At, pad: number) =>
  p.x > q.x - pad &&
  p.x < q.x + NODE_W + pad &&
  p.y > q.y - pad &&
  p.y < q.y + NODE_H + pad;

export type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const card = (p: At): Box => ({ x: p.x, y: p.y, w: NODE_W, h: NODE_H });
const grow = (b: Box, d: number): Box => ({
  x: b.x - d,
  y: b.y - d,
  w: b.w + 2 * d,
  h: b.h + 2 * d,
});
// whether a straight piece of line runs through a box
function crosses(p: At, q: At, b: Box): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 4));
  for (let k = 0; k <= n; k++) {
    const x = p.x + ((q.x - p.x) * k) / n;
    const y = p.y + ((q.y - p.y) * k) / n;
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
  }
  return false;
}
const labelBox = (c: At, label: string): Box => {
  const w = labelWidth(label);
  return { x: c.x - w / 2, y: c.y - LABEL_H / 2, w, h: LABEL_H };
};

// What is already drawn on a canvas, for the links routed after it: their
// lines and their labels. `marks`: other things a label must not sit on
// (a slot's own label at the top of a box, lane or column).
export type Drawn = { segs: [At, At][]; labels: Box[]; marks: Box[] };
export const nothingDrawn = (marks: Box[] = []): Drawn => ({
  segs: [],
  labels: [],
  marks,
});

// how far two straight pieces run along each other (both across, or both
// down, a few pixels apart): two links on one line read as one
function along(p: At, q: At, u: At, v: At): number {
  const flat = (a: At, b: At) => Math.abs(a.y - b.y) < 0.5;
  const tall = (a: At, b: At) => Math.abs(a.x - b.x) < 0.5;
  const run = (a0: number, a1: number, b0: number, b1: number) =>
    Math.max(
      0,
      Math.min(Math.max(a0, a1), Math.max(b0, b1)) -
        Math.max(Math.min(a0, a1), Math.min(b0, b1)),
    );
  if (flat(p, q) && flat(u, v) && Math.abs(p.y - u.y) < 7)
    return run(p.x, q.x, u.x, v.x);
  if (tall(p, q) && tall(u, v) && Math.abs(p.x - u.x) < 7)
    return run(p.y, q.y, u.y, v.y);
  return 0;
}

// What a route costs to read: a part it runs through (its own two included:
// an arc could leave a part and come back down through it) costs most, then
// a label on another label, a label on a card, a straight link too short to show
// its line beside its label, a run along a link already drawn, leaving the
// box both ends sit in, and last its length. The cheapest is drawn: a route
// with nothing clear was drawn as the first arc tried, through a part.
export function cost(
  from: string,
  to: string,
  at: Record<string, At>,
  r: Route,
  label: string,
  seen: Drawn = nothingDrawn(),
  within?: Box,
): number {
  const { pts, label: c } = pathOf(at[from], at[to], r);
  const parts = Object.entries(at);
  const through = new Set<string>();
  let out = 0;
  let len = 0;
  let run = 0;
  const whole = pts
    .slice(1)
    .reduce((n, q, i) => n + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const n = Math.max(1, Math.ceil(d / 4));
    for (let k = 0; k <= n; k++) {
      const x = {
        x: p.x + ((q.x - p.x) * k) / n,
        y: p.y + ((q.y - p.y) * k) / n,
      };
      // on a card or along its edge; its own two only away from where it
      // leaves and enters them (a line along the tops of two cards read
      // as their border)
      const far = len + (d * k) / n > 8 && whole - len - (d * k) / n > 8;
      for (const [id, o] of parts)
        if ((far || (id !== from && id !== to)) && hits(x, o, 2))
          through.add(id);
      if (
        within &&
        (x.x < within.x ||
          x.x > within.x + within.w ||
          x.y < within.y ||
          x.y > within.y + within.h)
      )
        out++;
    }
    for (const [u, v] of seen.segs) run += along(p, q, u, v);
    len += d;
  }
  let total = through.size * 100 + run * 0.4 + out + len * 0.02;
  // a line over another link's label hides it
  for (let i = 1; i < pts.length; i++)
    for (const l of seen.labels)
      if (crosses(pts[i - 1], pts[i], l)) total += 30;
  if (r.type === "arc") total += 3;
  else if (r.type === "elbow") total += r.mid === undefined ? 2 : 3;
  else if (r.type === "detour") total += 6;
  else if (
    // the facing sides read best; another pair of sides only to get clear
    JSON.stringify(facing(at[from], at[to])) !==
    JSON.stringify([r.source, r.target])
  )
    total += 4;
  if (label) {
    const box = labelBox(c, label);
    for (const [, o] of parts) if (overlap(box, card(o))) total += 40;
    // two labels on one spot read as neither ("causes ·s", with
    // "activates" under it): worse than any detour short of a part; two a
    // few pixels apart at a crossing could not be told apart either
    for (const l of seen.labels) if (overlap(grow(box, 8), l)) total += 90;
    // a label on another link's line reads as that link's ("causes" on the
    // run of the link beside it, by its own "causes")
    for (const [u, v] of seen.segs) if (crosses(u, v, box)) total += 30;
    for (const m of seen.marks) if (overlap(box, m)) total += 15;
    // the line must show beside its label: between parts stacked close,
    // the label covered all of it and the link read as a stub
    if (r.type === "straight") {
      const [s, t] = pts;
      const room =
        Math.abs(t.x - s.x) >= Math.abs(t.y - s.y)
          ? Math.abs(t.x - s.x) - box.w
          : Math.abs(t.y - s.y) - box.h;
      if (room < 16) total += 40;
    }
  }
  return total;
}

// Whether a route runs through a part other than its ends, or its label
// sits on any part, its own two included (on a short link the label lay on
// both cards; between neighbouring ticks the link could not be seen).
export function blocked(
  from: string,
  to: string,
  at: Record<string, At>,
  r: Route,
  label: string,
): boolean {
  const a = at[from];
  const b = at[to];
  const { pts, label: c } = pathOf(a, b, r);
  const others = Object.entries(at).filter(([id]) => id !== from && id !== to);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 4));
    for (let k = 0; k <= n; k++) {
      const x = {
        x: p.x + ((q.x - p.x) * k) / n,
        y: p.y + ((q.y - p.y) * k) / n,
      };
      if (others.some(([, o]) => hits(x, o, -2))) return true;
    }
  }
  if (!label) return false;
  const box = labelBox(c, label);
  return Object.values(at).some((o) => overlap(box, card(o)));
}

// Whether a line of runs straight across or down keeps off every card:
// off its own two too, but where it leaves and enters them
function clearRuns(
  pts: At[],
  at: Record<string, At>,
  from: string,
  to: string,
): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [p, q] = [pts[i - 1], pts[i]];
    const x0 = Math.min(p.x, q.x);
    const x1 = Math.max(p.x, q.x);
    const y0 = Math.min(p.y, q.y);
    const y1 = Math.max(p.y, q.y);
    const ends = i === 1 || i === pts.length - 1;
    for (const [id, o] of Object.entries(at)) {
      if (ends && (id === from || id === to)) continue;
      if (
        x1 > o.x - 2 &&
        x0 < o.x + NODE_W + 2 &&
        y1 > o.y - 2 &&
        y0 < o.y + NODE_H + 2
      )
        return false;
    }
  }
  return true;
}

const SIDES: Side[] = ["top", "right", "bottom", "left"];
// an elbow leaves by one side and enters by the side facing it
const ELBOWS: [Side, Side][] = [
  ["bottom", "top"],
  ["top", "bottom"],
  ["right", "left"],
  ["left", "right"],
];

// How to draw a link so it reads as linking its own two parts: the
// cheapest of straight lines between any two sides, elbows and arcs out of
// one side, near or far (cost). `nth`: a second link on the same two parts
// is never the straight line the first may be on: it bends (an elbow at
// another turn, kept off the first by its cost) or arcs out further, so
// each label is its own. Arcs alone left it nothing but a run round the
// outside and down through the part above its end. `seen`: the links drawn
// before this one, which it is kept off and is added to; `within`: the box
// both ends sit in, which it stays inside when it can (a hint's ghost ran
// out of its box to the canvas's edge and back).
export function route(
  from: string,
  to: string,
  at: Record<string, At>,
  label: string,
  nth = 0,
  seen?: Drawn,
  within?: Box,
): Route {
  const a = at[from];
  const b = at[to];
  if (!a || !b) return { type: "straight", source: "right", target: "left" };
  const flat = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const arcs: Side[] = flat
    ? ["top", "bottom", "left", "right"]
    : ["right", "left", "top", "bottom"];
  const tries: Route[] = [
    ...(nth
      ? []
      : SIDES.flatMap((source) =>
          SIDES.map((target): Route => ({
            type: "straight",
            source,
            target,
          })),
        )),
    ...ELBOWS.flatMap(([source, target]) =>
      [undefined, 0.25, 0.75].map((mid): Route => ({
        type: "elbow",
        source,
        target,
        ...(mid ? { mid } : {}),
      })),
    ),
    ...[30, 54, 84, 120, 170].flatMap((o) =>
      arcs.map((side): Route => ({ type: "arc", side, offset: o + 24 * nth })),
    ),
  ];
  let best = tries[0];
  let low = Infinity;
  // the label half way, or to one side when that clears it: a little way
  // first, so a label on a crossing moves just off it (with 0.3 on a card
  // edge, "enables" stayed on the line it crossed and read as that link's)
  const tryAll = (list: Route[], fs: number[]) => {
    for (const base of list)
      for (const f of label ? fs : [0.5]) {
        const r = f === 0.5 ? base : { ...base, at: f };
        const c =
          cost(from, to, at, r, label, seen, within) + (f === 0.5 ? 0 : 1);
        if (c < low - 1e-6) {
          low = c;
          best = r;
        }
      }
  };
  tryAll(tries, [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]);
  // Only when every route so far runs through a part or sits on another
  // link (its cost says so), a detour along the gaps beside the cards: they
  // are many, and tried on every link they slowed each drag.
  if (low >= 30) {
    const gaps = (vs: number[]) => [...new Set(vs.map(Math.round))];
    const cards = Object.values(at);
    const ys = gaps(cards.flatMap((o) => [o.y - 20, o.y + NODE_H + 20]));
    const xs = gaps(cards.flatMap((o) => [o.x - 20, o.x + NODE_W + 20]));
    const detours = SIDES.flatMap((source) =>
      SIDES.flatMap((target) => [
        ...ys.map((via): Route => ({
          type: "detour",
          source,
          target,
          axis: "y",
          via: via + 12 * nth,
        })),
        ...xs.map((via): Route => ({
          type: "detour",
          source,
          target,
          axis: "x",
          via: via + 12 * nth,
        })),
      ]),
    );
    // costed only once clear of every card: its runs are straight across
    // or down, so that is quick to tell, and costing them all took 16ms a
    // drag step
    tryAll(
      detours.filter((r) => clearRuns(pathOf(a, b, r).pts, at, from, to)),
      [0.5, 0.3, 0.7],
    );
  }
  if (seen) {
    const { pts, label: c } = pathOf(a, b, best);
    for (let i = 1; i < pts.length; i++) seen.segs.push([pts[i - 1], pts[i]]);
    if (label) seen.labels.push(labelBox(c, label));
  }
  return best;
}
