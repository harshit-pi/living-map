// The Waiting lens lights what waits on you and what that holds up; the
// card reads links from either end.

import assert from "node:assert/strict";
import { test } from "vitest";

import { groupsOf, heldUp, linkedTo, litBy, matcher } from "./lens.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

const item = (
  id: string,
  type: LedgerItem["type"],
  extra: Partial<LedgerItem> = {},
): LedgerItem => ({
  id,
  type,
  state: "",
  title: `${type} ${id}`,
  body: "",
  quote: "",
  src: [1],
  parent: type === "topic" ? null : "i1",
  basis: "said",
  links: [],
  waiting: false,
  open: false,
  isNew: false,
  order: id,
  ...extra,
});

const items = [
  item("i1", "topic"),
  item("i2", "ask", {
    state: "waiting",
    waiting: true,
    open: true,
    links: [{ rel: "blocks", to: "i3" }],
  }),
  item("i3", "task", {
    state: "to-do",
    open: true,
    links: [{ rel: "blocks", to: "i4" }],
  }),
  item("i4", "task", { state: "to-do", open: true }),
  item("i5", "task", {
    state: "to-do",
    open: true,
    links: [{ rel: "blocks", to: "i4" }], // not waiting: holds nothing up
  }),
  item("i6", "decision", {
    state: "decided",
    links: [{ rel: "answers", to: "i2" }],
  }),
  item("i7", "ask", {
    state: "waiting",
    waiting: true,
    links: [{ rel: "blocks", to: "i99" }], // gone from the map
  }),
];

test("what waits on you holds up what it blocks, and what that blocks in turn", () => {
  assert.deepEqual([...heldUp(items)].sort(), ["i3", "i4"]);
  const lit = litBy("waiting", items, new Set());
  assert.deepEqual(
    items.filter(lit).map((i) => i.id),
    ["i2", "i3", "i4", "i7"],
  );
  // counts stay what waits, not what waits on it
  assert.deepEqual(
    items.filter(matcher("waiting", new Set())).map((i) => i.id),
    ["i2", "i7"],
  );
  // the other lenses light only their own
  assert.deepEqual(
    items.filter(litBy("open", items, new Set())).map((i) => i.id),
    ["i2", "i3", "i4", "i5"],
  );
});

test("a link reads from either end", () => {
  assert.deepEqual(
    linkedTo(items, "i4").map((l) => `${l.rel}<${l.from.id}`),
    ["blocks<i3", "blocks<i5"],
  );
  assert.deepEqual(
    linkedTo(items, "i2").map((l) => `${l.rel}<${l.from.id}`),
    ["answers<i6"],
  );
  assert.deepEqual(linkedTo(items, "i1"), []);
});

test("closes the map made with no quote get their own group, right under what waits on you", () => {
  const g = groupsOf([
    item("t", "topic"),
    item("w", "ask", { state: "waiting", waiting: true, open: true }),
    item("c", "question", {
      state: "answered",
      unconfirmed: { from: "open", to: "answered", turn: 4 },
    }),
    item("s", "question", { state: "answered" }),
  ]);
  assert.deepEqual(
    g.map((x) => [x.id, x.items.map((i) => i.id)]),
    [
      ["waiting", ["w"]],
      ["check", ["c"]],
      ["settled", ["s"]],
    ],
  );
  assert.equal(g[1]!.label, "Closed by the map, to check");
});
