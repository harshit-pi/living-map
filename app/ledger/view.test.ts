// What the page sees of a store: live items only, new since you looked, the
// strip (what Claude is on, what waits on you, oldest first) and health.

import assert from "node:assert/strict";
import { test } from "vitest";

import { place } from "./apply.ts";
import type { State } from "./db.ts";
import { emptyStore, type Item } from "./items.ts";
import { buildView } from "./view.ts";

const item = (
  id: string,
  type: Item["type"],
  state: string,
  src: number,
  extra: Partial<Item> = {},
): Item => ({
  id,
  type,
  state,
  title: `${type} ${id}`,
  body: "",
  quote: "q",
  src: [src],
  parent: type === "topic" ? null : "i1",
  basis: "said",
  links: [],
  writers: {},
  ...extra,
});

function state(): State {
  const store = emptyStore("c", "A chat");
  for (const i of [
    item("i1", "topic", "", 1),
    item("i2", "ask", "waiting", 4),
    item("i3", "question", "open", 2, { owner: "you" }),
    item("i4", "task", "doing", 3, { owner: "claude" }),
    item("i5", "task", "done", 3),
    item("i6", "question", "open", 5, { owner: "you", retired: "not right" }),
    item("i7", "question", "open", 5, { owner: "claude" }),
  ])
    store.items.set(i.id, i);
  store.read = 5;
  const s: State = {
    conv: {
      root: "c",
      ids: ["c"],
      title: "A chat",
      cwd: "",
      file: "",
      lookedTurn: 3,
      following: true,
      linkedAt: 0,
      skipped: 0,
    },
    store,
    meta: new Map(),
  };
  place(s, 0);
  return s;
}

test("the view holds live items, the strip and health", () => {
  const v = buildView(state(), {
    turns: 7,
    behind: 1,
    following: true,
    error: "rate limited",
    spend: { calls: 2, usd: 0.03, todayUsd: 0.01 },
  });
  assert.deepEqual(
    v.items.map((i) => i.id),
    ["i1", "i2", "i3", "i4", "i5", "i7"],
  );
  const by = new Map(v.items.map((i) => [i.id, i]));
  assert.equal(by.get("i1")!.state, "waiting", "a topic's state is derived");
  assert.equal(by.get("i2")!.isNew, true);
  assert.equal(by.get("i3")!.isNew, false);
  assert.equal(by.get("i7")!.waiting, false, "Claude's to answer");
  assert.equal(by.get("i7")!.open, true);
  assert.equal(v.strip.doing, "task i4");
  assert.deepEqual(v.strip.waiting, ["i3", "i2"], "oldest first");
  assert.deepEqual(v.strip.since, { turns: 4, waiting: 1, changes: 0 });
  assert.deepEqual(v.health, {
    following: true,
    behind: 1,
    error: "rate limited",
  });
  assert.equal(v.read, 5);
  assert.equal(v.lookedTurn, 3);
  assert.deepEqual(v.changes, []);
  // siblings in the order they were filed
  const kids = v.items.filter((i) => i.parent === "i1").map((i) => i.order);
  assert.deepEqual([...kids].sort(), kids);
  assert.equal(new Set(kids).size, kids.length);
});

test("nothing in progress: no doing", () => {
  const s = state();
  s.store.items.get("i4")!.state = "done";
  const v = buildView(s, {
    turns: 5,
    behind: 0,
    following: false,
    reading: { done: 3, total: 40 },
    spend: { calls: 0, usd: 0, todayUsd: 0 },
  });
  assert.equal(v.strip.doing, null);
  assert.deepEqual(v.health, {
    following: false,
    behind: 0,
    reading: { done: 3, total: 40 },
  });
});

test("the topic the chat is on is the one its latest filed turn belongs to", () => {
  const s = state();
  s.store.items.set("i9", item("i9", "topic", "", 9));
  s.store.topicOf.set(3, "i9");
  s.store.topicOf.set(5, "i1");
  const f = {
    turns: 5,
    behind: 0,
    following: true,
    spend: { calls: 0, usd: 0, todayUsd: 0 },
  };
  assert.equal(buildView(s, f).now, "i1");
  // retired, it gives way to the topic of the turn before
  s.store.items.get("i1")!.retired = "merged";
  assert.equal(buildView(s, f).now, "i9");
});
