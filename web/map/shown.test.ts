// What the map draws: findings stay off it, decisions keep their box under
// their topic, what sat under a finding hangs from the nearest item still
// drawn, and the page opens with every topic but the one Claude is on folded.

import assert from "node:assert/strict";
import { test } from "vitest";

import { countsOf, descendants } from "./lens.ts";
import { mapItems, startFolds, trailOf } from "./shown.ts";
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
  item("o2", "option", "taken", "f1"),
  item("d2", "decision", "reopened", "t1"),
  item("t2", "topic", "active", null, "b"),
  item("q1", "question", "open", "t2"),
];

test("findings leave the map; decisions, settled or reopened, stay under their topic", () => {
  const ids = mapItems(ITEMS).map((i) => i.id);
  assert.deepEqual(ids, ["t1", "d1", "o1", "o2", "d2", "t2", "q1"]);
  assert.equal(mapItems(ITEMS).find((i) => i.id === "d1")!.parent, "t1");
});

test("what sat under a hidden item hangs from the nearest one still drawn", () => {
  const o2 = mapItems(ITEMS).find((i) => i.id === "o2")!;
  assert.equal(o2.parent, "t1");
  // the original is left as it was, for the card and the list
  assert.equal(ITEMS.find((i) => i.id === "o2")!.parent, "f1");
});

test("a topic's counts are the boxes it opens to, not what stays in the list", () => {
  const under = descendants(mapItems(ITEMS), "t1");
  assert.deepEqual(under.map((i) => i.id).sort(), ["d1", "d2", "o1", "o2"]);
  const c = countsOf(under);
  assert.equal(c.waiting + c.open + c.decided + c.settled, under.length);
  // d1 and the taken options are decided; the reopened d2 is not
  assert.equal(c.decided, 3);
});

test("the page opens with every topic folded but the one Claude is on", () => {
  assert.deepEqual(startFolds(ITEMS), { t1: true });
});

test("the server's topic wins over a guess from the items", () => {
  assert.deepEqual(startFolds(ITEMS, "t1"), { t2: true });
});

test("the trail is the picked item and everything above it", () => {
  const m = mapItems(ITEMS);
  assert.deepEqual([...trailOf(m, "o1")], ["o1", "d1", "t1"]);
  assert.deepEqual([...trailOf(m, null)], []);
  assert.deepEqual([...trailOf(m, "gone")], []);
});
