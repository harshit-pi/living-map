// Where the inspector opens on the canvas. Pure, so it is tested alongside
// the load check.

// a rectangle on the canvas, in pixels
export type Rect = { left: number; top: number; w: number; h: number };

// Beside what you picked: right of it, or left; when neither side has room,
// under it or above it, so the card (and its load bar) stays in sight while
// you change it. When every spot covers some of it, the one that covers
// least. `room` is where the panel's top-left corner may go.
export function beside(
  at: Rect,
  panel: { w: number; h: number },
  room: { minLeft: number; maxLeft: number; minTop: number; maxTop: number },
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.round(Math.max(lo, Math.min(hi, v)));
  const spot = (left: number, top: number) => ({
    left: clamp(left, room.minLeft, room.maxLeft),
    top: clamp(top, room.minTop, room.maxTop),
  });
  const spots = [
    spot(at.left + at.w + 12, at.top),
    spot(at.left - panel.w - 12, at.top),
    spot(at.left, at.top + at.h + 12),
    spot(at.left, at.top - panel.h - 12),
  ];
  // how much of it (and a margin round it, so a wire's midpoint counts) a
  // spot covers
  const covers = (p: { left: number; top: number }) =>
    Math.max(
      0,
      Math.min(p.left + panel.w, at.left + at.w + 8) -
        Math.max(p.left, at.left - 8),
    ) *
    Math.max(
      0,
      Math.min(p.top + panel.h, at.top + at.h + 8) -
        Math.max(p.top, at.top - 8),
    );
  return spots.reduce((best, p) => (covers(p) < covers(best) ? p : best));
}
