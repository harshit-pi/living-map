// Matching the extractor's lists to the labeler's on synthetic items: the
// turn window, title similarity, one-to-one pairing best first, and the open
// list scored with what waits on you.

import assert from "node:assert/strict";
import { test } from "vitest";

import type { Item } from "./items.ts";
import {
  asListed,
  type Label,
  matchList,
  matchLists,
  similarity,
  tokens,
} from "./match.ts";

const item = (id: string, title: string, src: number[], extra = {}): Item => ({
  id,
  type: "ask",
  state: "waiting",
  title,
  body: "",
  quote: "",
  src,
  parent: null,
  basis: "said",
  links: [],
  writers: {},
  ...extra,
});
const label = (title: string, turn: number): Label => ({ title, turn });
const none = { waiting: [], open: [], decided: [], taken: [] };

test("tokens drop stopwords, case and plural s", () => {
  assert.deepEqual(
    [...tokens("Should we pick the Postgres schemas?")],
    ["pick", "postgre", "schema"],
  );
  assert.deepEqual([...tokens("Pass the class")], ["pass", "class"]);
});

test("similarity takes Jaccard of at least 0.25, or one title inside the other", () => {
  assert.equal(
    similarity("pick a database", "pick the database engine"),
    2 / 3,
  );
  // {retry, policy, upload} against {decide, retry, budget, upload, worker}: 2/6
  assert.equal(
    similarity(
      "retry policy for uploads",
      "decide the retry budget of upload workers",
    ),
    2 / 6,
  );
  assert.equal(similarity("rename the flag", "ship the release notes"), null);
  // one word in five is under 0.25, but it is all of the shorter title
  assert.equal(
    similarity("caching", "decide caching layer for api reads"),
    0.2,
  );
  assert.equal(similarity("the", "the and"), null);
});

test("a label matches only near one of the item's source turns", () => {
  const it = item("i1", "confirm the deploy region", [10, 30]);
  assert.equal(
    matchList([it], [label("confirm deploy region", 12)]).pairs.length,
    1,
  );
  assert.equal(
    matchList([it], [label("confirm deploy region", 28)]).pairs.length,
    1,
  );
  const far = matchList([it], [label("confirm deploy region", 20)]);
  assert.equal(far.pairs.length, 0);
  assert.deepEqual(far.mapOnly, [it]);
  assert.deepEqual(far.labelOnly, [label("confirm deploy region", 20)]);
});

test("pairs are one to one, best score first", () => {
  const a = item("i1", "choose the queue library", [5]);
  const b = item("i2", "choose the queue", [5]);
  const exact = label("choose the queue", 5);
  const wide = label("choose queue library for jobs", 6);
  const m = matchList([a, b], [wide, exact]);
  // b–exact scores 1, so a gets the other label rather than exact
  assert.deepEqual(
    m.pairs.map((p) => [p.item.id, p.label.title]),
    [
      ["i2", "choose the queue"],
      ["i1", "choose queue library for jobs"],
    ],
  );
  assert.equal(m.mapOnly.length + m.labelOnly.length, 0);
});

test("ties go to the nearer turn", () => {
  const a = item("i1", "answer the pricing question", [8]);
  const near = label("answer pricing question", 9);
  const far = label("answer pricing question", 10);
  const m = matchList([a], [far, near]);
  assert.equal(m.pairs[0]!.label, near);
  assert.deepEqual(m.labelOnly, [far]);
});

test("an item with no source turn matches nothing", () => {
  const m = matchList([item("i1", "x y z", [])], [label("x y z", 1)]);
  assert.equal(m.pairs.length, 0);
});

test("matchLists keeps each list apart and skips unknown ids", () => {
  const ask = item("i1", "supply the API base URL", [3]);
  const dec = item("i2", "use SQLite for the store", [4], {
    type: "decision",
    state: "decided",
  });
  const m = matchLists(
    [ask, dec],
    { waiting: ["i1", "i9"], open: ["i1"], decided: ["i2"], taken: [] },
    {
      ...none,
      waiting: [label("supply API base URL", 3)],
      decided: [label("supply API base URL", 3)],
    },
  );
  assert.equal(m.waiting.pairs.length, 1);
  assert.equal(m.open.mapOnly.length, 1);
  assert.equal(m.decided.pairs.length, 0);
  assert.equal(m.decided.mapOnly[0]!.id, "i2");
  assert.equal(m.decided.labelOnly.length, 1);
});

test("asListed scores open against waiting too, once each", () => {
  const w = label("confirm the region", 4);
  const l = asListed({
    ...none,
    waiting: [w],
    open: [label("Confirm region", 4), label("write the migration", 6)],
  });
  assert.deepEqual(
    l.open.map((x) => x.title),
    ["confirm the region", "write the migration"],
  );
  assert.deepEqual(l.waiting, [w]);
});
