// How a box says its state: the flag only while an ask still waits on you,
// and one check for whatever is done.

import assert from "node:assert/strict";
import { test } from "vitest";

import { lookOf } from "./look.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

const ask = (state: string, waiting: boolean): LedgerItem => ({
  id: "a1",
  type: "ask",
  state,
  title: "a1",
  body: "",
  quote: "",
  src: [1],
  parent: null,
  basis: "said",
  links: [],
  waiting,
  open: false,
  isNew: false,
  order: "a",
});

test("an ask keeps its flag only while it waits on you", () => {
  assert.equal(lookOf(ask("waiting", true)).glyph, "⚑");
  assert.equal(lookOf(ask("done", false)).glyph, "✓");
  assert.equal(lookOf(ask("dropped", false)).glyph, "–");
});

test("a done task and a done ask carry the same check", () => {
  const task = { ...ask("done", false), type: "task" as const };
  assert.equal(lookOf(task).glyph, "✓");
  assert.equal(lookOf(task).glyph, lookOf(ask("done", false)).glyph);
});

test("a settled topic drops its box but keeps its size; one in play keeps it", () => {
  const topic = (state: string) => ({
    ...ask(state, false),
    type: "topic" as const,
  });
  const settled = lookOf(topic("done")).box;
  assert.match(settled, /border-transparent/);
  assert.match(settled, /\bborder\b/);
  assert.doesNotMatch(lookOf(topic("active")).box, /transparent/);
});
