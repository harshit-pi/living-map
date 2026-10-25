// What the map draws: findings and settled decisions stay off it, what sat
// under them hangs from the nearest item still drawn, and the page opens with
// every topic but the one Claude is on folded.

import assert from "node:assert/strict";
import { test } from "vitest";

import { mapItems, startFolds } from "./shown.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

const item = (
  id: string,
  type: LedgerItem["type"],
  state: string,
  parent: string | null,
  order = id,
): LedgerItem => ({
  id,
  type,
  state,
  title: id,
  body: "",
  quote: "",
  src: [1],
  parent,
  basis: "said",
  links: [],
  waiting: false,
  open: false,
  isNew: false,
  order,
});

const ITEMS = [
  item("t1", "topic", "done", null, "a"),
  item("d1", "decision", "decided", "t1"),
  item("o1", "option", "taken", "d1"),
  item("f1", "finding", "said", "t1"),
  item("d2", "decision", "reopened", "t1"),
  item("t2", "topic", "active", null, "b"),
  item("q1", "question", "open", "t2"),
];

test("findings and settled decisions leave the map; a reopened decision stays", () => {
  const ids = mapItems(ITEMS).map((i) => i.id);
  assert.deepEqual(ids, ["t1", "o1", "d2", "t2", "q1"]);
});

test("what sat under a hidden item hangs from the nearest one still drawn", () => {
  const o1 = mapItems(ITEMS).find((i) => i.id === "o1")!;
  assert.equal(o1.parent, "t1");
  // the original is left as it was, for the card and the list
  assert.equal(ITEMS.find((i) => i.id === "o1")!.parent, "d1");
});

test("the page opens with every topic folded but the one Claude is on", () => {
  assert.deepEqual(startFolds(ITEMS), { t1: true });
});
