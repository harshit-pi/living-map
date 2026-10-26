// One-time tips: which kind of box each item stands for, and which tip comes
// next when several kinds are on screen.

import assert from "node:assert/strict";
import { test } from "vitest";

import { kindOf, nextTip } from "./tips.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

const item = (
  id: string,
  type: LedgerItem["type"],
  state: string,
  more: Partial<LedgerItem> = {},
): LedgerItem => ({
  id,
  type,
  state,
  title: id,
  body: "",
  quote: "",
  src: [1],
  parent: null,
  basis: "said",
  links: [],
  waiting: false,
  open: false,
  isNew: false,
  order: id,
  ...more,
});

test("each box stands for the tip its look needs", () => {
  assert.equal(
    kindOf(item("a", "ask", "waiting", { waiting: true })),
    "waiting",
  );
  assert.equal(kindOf(item("t", "task", "todo", { waiting: true })), "waiting");
  assert.equal(kindOf(item("t", "task", "doing")), "task");
  assert.equal(kindOf(item("t", "task", "done")), "settled");
  assert.equal(kindOf(item("t", "task", "dropped")), "settled");
  assert.equal(kindOf(item("p", "topic", "active")), "topic");
  assert.equal(kindOf(item("p", "topic", "done")), "settled");
  assert.equal(
    kindOf(item("q", "question", "open", { open: true })),
    "question",
  );
  assert.equal(kindOf(item("q", "question", "answered")), "settled");
  assert.equal(kindOf(item("o", "option", "offered")), "option");
  assert.equal(kindOf(item("s", "assumption", "assumed")), "assumption");
  assert.equal(kindOf(item("s", "assumption", "confirmed")), "settled");
  assert.equal(kindOf(item("d", "decision", "reopened")), null);
});

test("what waits on you comes first, then the lenses, then the rest", () => {
  const onScreen = [
    item("p1", "topic", "active"),
    item("t1", "task", "doing"),
    item("a1", "ask", "waiting", { waiting: true }),
    item("a2", "ask", "waiting", { waiting: true }),
  ];
  assert.deepEqual(nextTip(onScreen, true, new Set()), {
    tip: "waiting",
    item: "a1",
  });
  assert.deepEqual(nextTip(onScreen, true, new Set(["waiting"])), {
    tip: "lenses",
    item: null,
  });
  assert.deepEqual(nextTip(onScreen, false, new Set(["waiting"])), {
    tip: "topic",
    item: "p1",
  });
});

test("a seen tip never comes back, and nothing new on screen shows none", () => {
  const onScreen = [item("t1", "task", "doing")];
  assert.equal(nextTip(onScreen, false, new Set(["task"])), null);
  assert.equal(nextTip([], false, new Set()), null);
});
