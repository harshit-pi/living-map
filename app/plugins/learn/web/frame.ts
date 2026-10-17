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
const COL_W = 200;
const BOX_W = 420;
const BOX_H = 300;
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
};

// lanes run across, so a lane is a band of height; the axis and sort columns
// run down; boxes are rectangles, three to a row
const across = (f: Frame) => f.kind === "lanes";
const down = (f: Frame) => f.kind === "axis" || f.kind === "sort";

// The frame's slots on the canvas, sized to hold what is on it (`span`: how
// far the parts reach, across for lanes and down for columns).
export function regions(frame: Frame, span = 0): Region[] {
  switch (frame.kind) {
    case "lanes": {
      const w = Math.max(640, span + NODE_W + 80);
      return frame.lanes.map((l, i) => ({
        slot: l,
        label: l,
        x: -LANE_LABEL,
        y: i * LANE_H,
        w: w + LANE_LABEL,
        h: LANE_H - 8,
      }));
    }
    case "axis":
    case "sort": {
      const cols = frame.kind === "axis" ? frame.ticks : frame.columns;
      const h = Math.max(420, span + NODE_H + 60);
      return cols.map((c, i) => ({
        slot: c,
        label: c,
        x: i * COL_W,
        y: -TOP,
        w: COL_W - 12,
        h: h + TOP,
      }));
    }
    case "boxes":
      return frame.boxes.map((b, i) => ({
        slot: b.id,
        label: b.label,
        x: (i % BOX_ROW) * (BOX_W + 40),
        y: Math.floor(i / BOX_ROW) * (BOX_H + 40),
        w: BOX_W,
        h: BOX_H,
      }));
    default:
      return [];
  }
}

// how far the parts reach, so the frame grows to hold them
export function spanOf(frame: Frame, at: At[]): number {
  if (across(frame)) return Math.max(0, ...at.map((p) => p.x));
  if (down(frame)) return Math.max(0, ...at.map((p) => p.y));
  return 0;
}

const centre = (p: At): At => ({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 });

const inside = (r: Region, frame: Frame, p: At) => {
  const c = centre(p);
  if (across(frame)) return c.y >= r.y && c.y < r.y + r.h + 8;
  if (down(frame)) return c.x >= r.x && c.x < r.x + r.w + 12;
  return c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;
};

// The slot a part dropped at `p` lands in, or null outside every slot.
export function slotAt(frame: Frame, p: At, span = 0): string | null {
  return regions(frame, span).find((r) => inside(r, frame, p))?.slot ?? null;
}

// Where the parts outside the frame wait: under the lanes and the boxes,
// right of the columns. A framed canvas draws a part with no slot there, never
// inside a slot it is not in, so the picture reads as the check does.
// `label`: the worked case keeps its hidden part here, where its slot would
// point at the answer.
export function looseZone(
  frame: Frame,
  span = 0,
  label?: string,
): Region | null {
  const rs = regions(frame, span);
  if (!rs.length) return null;
  if (down(frame)) {
    const right = Math.max(...rs.map((r) => r.x + r.w)) + 40;
    return {
      slot: "",
      label: label ?? "Not in a column yet",
      x: right,
      y: -TOP,
      w: NODE_W + 28,
      h: rs[0].h,
    };
  }
  const bottom = Math.max(...rs.map((r) => r.y + r.h)) + 30;
  return {
    slot: "",
    label: label ?? (across(frame) ? "Not in a lane yet" : "Not in a box yet"),
    x: rs[0].x,
    y: bottom,
    w: Math.max(...rs.map((r) => r.x + r.w)) - rs[0].x,
    h: NODE_H + 52,
  };
}

const looseSpot = (frame: Frame, z: Region, i: number): At =>
  down(frame)
    ? { x: z.x + 14, y: z.y + 32 + i * (NODE_H + GAP) }
    : { x: z.x + 14 + i * (NODE_W + GAP), y: z.y + 34 };

// a spot inside a box: two parts to a row, under its label
const boxSpot = (r: Region, k: number): At => ({
  x: r.x + 14 + (k % 2) * (NODE_W + 40),
  y: r.y + 36 + Math.floor(k / 2) * (NODE_H + GAP),
});

// Where each placed part is drawn. On a free map, where it is. On a frame,
// where it is when that is inside its slot, pulled into its slot when not,
// and in the waiting zone when it has no slot. In a box, always under the
// box's label (a part at the box's corner sat on "CONGRESS").
export function drawn(
  frame: Frame,
  placed: (At & { id: string; slot?: string })[],
): Record<string, At> {
  const span = spanOf(
    frame,
    placed.filter((p) => p.slot),
  );
  const rs = regions(frame, span);
  const out: Record<string, At> = {};
  if (!rs.length) {
    for (const p of placed) out[p.id] = { x: p.x, y: p.y };
    return out;
  }
  const z = looseZone(frame, span)!;
  let loose = 0;
  for (const p of placed) {
    const r = p.slot ? rs.find((x) => x.slot === p.slot) : undefined;
    if (!r) out[p.id] = looseSpot(frame, z, loose++);
    else if (inside(r, frame, p) && frame.kind !== "boxes")
      out[p.id] = { x: p.x, y: p.y };
    else if (across(frame))
      out[p.id] = { x: Math.max(p.x, 8), y: r.y + (r.h - NODE_H) / 2 };
    else if (down(frame))
      out[p.id] = { x: r.x + (r.w - NODE_W) / 2, y: Math.max(p.y, 8) };
    else
      out[p.id] = {
        x: Math.min(Math.max(p.x, r.x + 12), r.x + r.w - NODE_W - 12),
        y: Math.min(Math.max(p.y, r.y + 34), r.y + r.h - NODE_H - 12),
      };
  }
  // two parts pulled to one spot would hide each other: a later one moves
  // on along its lane or down its column until it is clear; in a box, to
  // the box's next free spot (pushed down, it was drawn under the box while
  // the check counted it in)
  const done: At[] = [];
  for (const p of placed) {
    const q = out[p.id];
    const r = p.slot ? rs.find((x) => x.slot === p.slot) : undefined;
    if (r && frame.kind === "boxes" && !clear(done, q)) {
      for (let k = 0; k < 12; k++) {
        const at = boxSpot(r, k);
        if (clear(done, at)) {
          Object.assign(q, at);
          break;
        }
      }
    }
    for (let k = 0; k < 40 && !clear(done, q); k++)
      if (across(frame)) q.x += NODE_W + GAP;
      else q.y += NODE_H + GAP;
    done.push(q);
  }
  return out;
}

const clear = (taken: At[], p: At) =>
  taken.every(
    (t) =>
      Math.abs(t.x - p.x) > NODE_W + GAP / 2 ||
      Math.abs(t.y - p.y) > NODE_H + GAP / 2,
  );

// The next free spot in a slot: along a lane, down a column, across a box.
export function spotIn(frame: Frame, r: Region, taken: At[]): At {
  for (let k = 0; k < 40; k++) {
    const p = across(frame)
      ? { x: 16 + k * ALONG_X, y: r.y + (r.h - NODE_H) / 2 }
      : down(frame)
        ? { x: r.x + (r.w - NODE_W) / 2, y: 8 + k * ALONG_Y }
        : boxSpot(r, k);
    if (clear(taken, p)) return p;
  }
  return { x: r.x + 14, y: r.y + 36 };
}

// Where a part goes when you click it in the tray. On a time axis, the first
// tick with nothing on it, so clicking the parts in order lays them out in
// order. In lanes, boxes and sort columns, which slot a part belongs in is
// part of what you are building, so it waits outside the frame for you to
// drag it in. On a free map, the next free spot on a grid.
export function nextSpot(
  frame: Frame,
  placed: (At & { slot?: string })[],
): At & { slot?: string } {
  const rs = regions(frame, spanOf(frame, placed));
  if (frame.kind === "axis") {
    const r = rs.find((x) => !placed.some((p) => p.slot === x.slot));
    if (r) return { ...spotIn(frame, r, placed), slot: r.slot };
  }
  if (rs.length) {
    const z = looseZone(frame, spanOf(frame, placed))!;
    return looseSpot(frame, z, placed.filter((p) => !p.slot).length);
  }
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
  const rs = regions(frame);
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
  const z = looseZone(frame)!;
  loose
    .sort((a, b) => free[a.id].x - free[b.id].x)
    .forEach((p, i) => {
      out[p.id] = looseSpot(frame, z, i);
    });
  return out;
}

// ---------------------------------------------------------------- links

export type Side = "top" | "right" | "bottom" | "left";
// how a link is drawn: straight between two sides, or as an arc that
// leaves and enters on one side, that far out
export type Route =
  | { type: "straight"; source: Side; target: Side }
  | { type: "arc"; side: Side; offset: number };

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

// the sides a straight link leaves and enters by: across when the parts sit
// side by side, down when one is above the other
export function facing(a: At, b: At): [Side, Side] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy) * 1.4)
    return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

// The line a route draws (as React Flow draws it: an arc runs out from the
// farther of its two ends), and where its label sits.
function pathOf(a: At, b: At, r: Route): { pts: At[]; label: At } {
  if (r.type === "straight") {
    const s = handleAt(a, r.source);
    const t = handleAt(b, r.target);
    return { pts: [s, t], label: { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 } };
  }
  const s = handleAt(a, r.side);
  const t = handleAt(b, r.side);
  const o = r.offset;
  if (r.side === "top" || r.side === "bottom") {
    const y =
      r.side === "bottom" ? Math.max(s.y, t.y) + o : Math.min(s.y, t.y) - o;
    return {
      pts: [s, { x: s.x, y }, { x: t.x, y }, t],
      label: { x: (s.x + t.x) / 2, y },
    };
  }
  const x =
    r.side === "right" ? Math.max(s.x, t.x) + o : Math.min(s.x, t.x) - o;
  return {
    pts: [s, { x, y: s.y }, { x, y: t.y }, t],
    label: { x, y: (s.y + t.y) / 2 },
  };
}

const hits = (p: At, q: At, pad: number) =>
  p.x > q.x - pad &&
  p.x < q.x + NODE_W + pad &&
  p.y > q.y - pad &&
  p.y < q.y + NODE_H + pad;

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
  const w = labelWidth(label) / 2;
  const box = { x: c.x - w, y: c.y - LABEL_H / 2 };
  return Object.values(at).some(
    (o) =>
      box.x < o.x + NODE_W &&
      box.x + 2 * w > o.x &&
      box.y < o.y + NODE_H &&
      box.y + LABEL_H > o.y,
  );
}

// How to draw a link so it reads as linking its own two parts: straight
// when that runs clear of every other part with its label off the cards,
// else the nearest arc that does, above or below a row, beside a column.
// `nth`: a second link on the same two parts arcs out further, so each
// label is its own.
export function route(
  from: string,
  to: string,
  at: Record<string, At>,
  label: string,
  nth = 0,
): Route {
  const a = at[from];
  const b = at[to];
  if (!a || !b) return { type: "straight", source: "right", target: "left" };
  const [source, target] = facing(a, b);
  const flat = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const sides: Side[] = flat
    ? ["top", "bottom", "left", "right"]
    : ["right", "left", "top", "bottom"];
  const tries: Route[] = [
    ...(nth ? [] : [{ type: "straight", source, target } as Route]),
    ...[30, 54, 84, 120, 170].flatMap((o) =>
      sides.map((side): Route => ({ type: "arc", side, offset: o + 24 * nth })),
    ),
  ];
  return (
    tries.find((r) => !blocked(from, to, at, r, label)) ??
    tries.find((r) => r.type === "arc")!
  );
}
