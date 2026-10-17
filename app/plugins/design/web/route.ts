// Which dots a wire runs between on the canvas. Pure, so it is tested
// alongside the load check.

import { SIDES, type Side } from "../shared.ts";

export const NODE_W = 172;
export const NODE_H = 84;

export type At = { x: number; y: number };
// a card: where it is, and its measured size when there is one
export type Box = At & { w?: number; h?: number };
type Card = { x: number; y: number; w: number; h: number };

const card = (b: Box | undefined): Card => ({
  x: b?.x ?? 0,
  y: b?.y ?? 0,
  w: b?.w ?? NODE_W,
  h: b?.h ?? NODE_H,
});

const dot = (p: Card, side: Side): At =>
  side === "top"
    ? { x: p.x + p.w / 2, y: p.y }
    : side === "bottom"
      ? { x: p.x + p.w / 2, y: p.y + p.h }
      : side === "left"
        ? { x: p.x, y: p.y + p.h / 2 }
        : { x: p.x + p.w, y: p.y + p.h / 2 };

// where React Flow puts a bezier's control point for a dot on this side
function control(side: Side, from: At, to: At): At {
  const off = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d));
  if (side === "left") return { x: from.x - off(from.x - to.x), y: from.y };
  if (side === "right") return { x: from.x + off(to.x - from.x), y: from.y };
  if (side === "top") return { x: from.x, y: from.y - off(from.y - to.y) };
  return { x: from.x, y: from.y + off(to.y - from.y) };
}

// how badly the wire's curve runs over (or brushes) other parts' cards: each
// card it goes under counts most, then how far it runs under them
function overlap(a: Card, b: Card, [sa, sb]: [Side, Side], others: Card[]) {
  const p0 = dot(a, sa);
  const p3 = dot(b, sb);
  const p1 = control(sa, p0, p3);
  const p2 = control(sb, p3, p0);
  const under = new Set<Card>();
  let n = 0;
  for (let i = 1; i < 48; i++) {
    const t = i / 48;
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    const x = k[0] * p0.x + k[1] * p1.x + k[2] * p2.x + k[3] * p3.x;
    const y = k[0] * p0.y + k[1] * p1.y + k[2] * p2.y + k[3] * p3.y;
    for (const o of others)
      if (
        x > o.x - 6 &&
        x < o.x + o.w + 6 &&
        y > o.y - 6 &&
        y < o.y + o.h + 6
      ) {
        under.add(o);
        n++;
      }
  }
  return under.size * 12 + n;
}

// the side a wire leaves by to head straight for the other card
function facing(a: Card, b: Card): [Side, Side][] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const across = Math.abs(dx) - NODE_W > Math.abs(dy) - NODE_H;
  const sideways: [Side, Side] = dx > 0 ? ["right", "left"] : ["left", "right"];
  const upright: [Side, Side] = dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
  const [first, second] = across ? [sideways, upright] : [upright, sideways];
  return [first, second, [first[0], second[1]], [second[0], first[1]]];
}

type Routed = {
  id: string;
  from: string;
  to: string;
  fromSide?: Side;
  toSide?: Side;
};

// A wire runs between the dots you dragged it between. One without (Claude's
// wires, the reference, older maps) runs between the facing sides of its two
// parts: side to side when they sit next to each other, top to bottom when one
// is above the other. When that would draw it over another part, it leaves by
// the sides that cross the fewest cards; and it keeps off a dot that already
// carries a wire the other way, which would read as one line running through
// the part. A second pass lets an early wire step aside for a later one. The
// second of two opposite wires between the same parts loops round instead, so
// the two can be told apart.
export function route(
  wires: Routed[],
  boxes: Map<string, Box>,
): Map<string, [Side, Side]> {
  const out = new Map<string, [Side, Side]>();
  // how many wires run in and out of each dot
  const used = new Map<string, { in: number; out: number }>();
  const count = (w: Routed, by: number) => {
    const s = out.get(w.id);
    if (!s) return;
    for (const [k, way] of [
      [`${w.from}:${s[0]}`, "out"],
      [`${w.to}:${s[1]}`, "in"],
    ] as const) {
      const u = used.get(k) ?? { in: 0, out: 0 };
      u[way] += by;
      used.set(k, u);
    }
  };
  const set = (w: Routed, s: [Side, Side]) => {
    out.set(w.id, s);
    count(w, 1);
  };
  const clash = (id: string, side: Side, way: "in" | "out") =>
    (used.get(`${id}:${side}`)?.[way === "in" ? "out" : "in"] ?? 0) > 0 ? 1 : 0;
  const pairs = new Set(wires.map((w) => `${w.from}>${w.to}`));
  const auto: Routed[] = [];
  // the dots you chose first, and the loops, so the rest keep clear of them
  for (const w of wires) {
    if (w.fromSide && w.toSide) set(w, [w.fromSide, w.toSide]);
    else if (pairs.has(`${w.to}>${w.from}`) && w.from > w.to) {
      const [first] = facing(card(boxes.get(w.from)), card(boxes.get(w.to)));
      set(
        w,
        first[0] === "right" || first[0] === "left"
          ? ["bottom", "bottom"]
          : ["right", "right"],
      );
    } else auto.push(w);
  }
  for (let pass = 0; pass < 2; pass++)
    for (const w of auto) {
      count(w, -1);
      const a = card(boxes.get(w.from));
      const b = card(boxes.get(w.to));
      const others = [...boxes]
        .filter(([id]) => id !== w.from && id !== w.to)
        .map(([, o]) => card(o));
      // the facing sides first; then every other pair of sides
      const options = facing(a, b);
      for (const sa of SIDES)
        for (const sb of SIDES)
          if (sa !== sb && !options.some(([x, y]) => x === sa && y === sb))
            options.push([sa, sb]);
      let best = options[0];
      let least = Infinity;
      for (const [i, o] of options.entries()) {
        // running under a card costs most, then sharing a dot, then a roundabout way
        const n =
          overlap(a, b, o, others) +
          (clash(w.from, o[0], "out") + clash(w.to, o[1], "in")) * 16 +
          (i < 4 ? 0 : 3);
        if (n < least) [best, least] = [o, n];
        if (n === 0) break;
      }
      set(w, best);
    }
  return out;
}
