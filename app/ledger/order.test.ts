// Order keys: every key sorts between its neighbours, appending never
// touches an earlier key, and keys stay short for the sizes a map reaches.

import assert from "node:assert/strict";
import { test } from "vitest";

import { isKey, keyAfter, keyBetween } from "./order.ts";

test("a key sorts strictly between its neighbours", () => {
  const cases: [string | null, string | null][] = [
    [null, null],
    ["V", null],
    [null, "V"],
    ["V", "W"],
    ["V", "VV"],
    ["Vz", "W"],
    [null, "1"],
    [null, "01"],
    ["z", null],
    ["zzz", null],
    ["a", "b"],
    ["a1", "a2"],
  ];
  for (const [a, b] of cases) {
    const k = keyBetween(a, b);
    assert.ok(isKey(k), `${k} is a key`);
    if (a !== null) assert.ok(a < k, `${a} < ${k}`);
    if (b !== null) assert.ok(k < b, `${k} < ${b}`);
  }
  assert.throws(() => keyBetween("b", "a"));
  assert.throws(() => keyBetween("a", "a"));
});

test("appending keeps every earlier key and stays short", () => {
  const keys: string[] = [];
  for (let i = 0; i < 500; i++) keys.push(keyAfter(keys));
  assert.deepEqual([...keys].sort(), keys);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.at(-1)!.length <= 18, keys.at(-1)!);
});

test("random inserts keep the order a list would have", () => {
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const list: string[] = [];
  for (let i = 0; i < 400; i++) {
    const at = rand(list.length + 1);
    const k = keyBetween(list[at - 1] ?? null, list[at] ?? null);
    assert.ok(isKey(k));
    list.splice(at, 0, k);
  }
  assert.deepEqual([...list].sort(), list);
  assert.equal(new Set(list).size, list.length);
});
