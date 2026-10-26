// Where an item sits among its siblings: a fractional order key, a string
// that sorts between two others, so a new item gets a place of its own and
// nothing already placed moves. Base 62 in ASCII order ("0"-"9", "A"-"Z",
// "a"-"z"), so plain string comparison is the order. A key never ends in
// "0": there is always room on both sides of it.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const FIRST = "V"; // the first key leaves as much room before as after

const digit = (c: string | undefined) =>
  c === undefined ? 0 : DIGITS.indexOf(c);

export const isKey = (k: string) =>
  k.length > 0 && !k.endsWith("0") && [...k].every((c) => DIGITS.includes(c));

// a key after `a`: the next first digit where there is one, so appending
// grows a key by one character only every 36 or so items
function after(a: string): string {
  if (!a) return FIRST;
  const d = digit(a[0]);
  if (d < DIGITS.length - 1) return DIGITS[d + 1]!;
  return `${a[0]}${after(a.slice(1))}`;
}

// a key strictly between `a` and `b` (`a` < `b`; "" is the start)
function midpoint(a: string, b: string): string {
  let n = 0;
  while ((a[n] ?? "0") === b[n]) n++;
  if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  const da = digit(a[0]);
  const db = digit(b[0]);
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]!;
  // neighbouring digits: b's first digit alone is between them when b goes
  // on, else the key goes on from a's first digit
  if (b.length > 1) return b[0]!;
  return `${DIGITS[da]}${after(a.slice(1))}`;
}

// A key between two neighbours; null is the start or the end.
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b)
    throw new Error(`order keys out of order: ${a} >= ${b}`);
  if (b === null) return after(a ?? "");
  return midpoint(a ?? "", b);
}

// the key for a new last sibling
export const keyAfter = (siblings: Iterable<string>): string => {
  let last: string | null = null;
  for (const k of siblings) if (last === null || k > last) last = k;
  return keyBetween(last, null);
};
