// The outline the chat reads back: what matters now first, settled topics
// folded, and a lens giving one section alone.

import assert from "node:assert/strict";
import { test } from "vitest";

import { outline, outlineLens } from "./outline.ts";
import type { LedgerItem, LedgerView } from "../shared/ledger.ts";

const item = (
  id: string,
  type: LedgerItem["type"],
  state: string,
  extra: Partial<LedgerItem> = {},
): LedgerItem => ({
  id,
  type,
  state,
  title: `${type} ${id}`,
  body: "",
  quote: `said ${id}`,
  src: [Number(id.slice(1))],
  parent: type === "topic" ? null : "i1",
  basis: "said",
  links: [],
  waiting: false,
  open: false,
  isNew: false,
  order: id.padStart(4, "0"),
  ...extra,
});

function view(): LedgerView {
  return {
    conv: "c",
    title: "Networking",
    turns: 12,
    read: 10,
    lookedTurn: 0,
    items: [
      item("i1", "topic", "active"),
      item("i2", "ask", "waiting", { waiting: true, open: true, owner: "you" }),
      item("i3", "task", "doing", { open: true, owner: "claude" }),
      item("i4", "decision", "decided", {
        body: "Peering needs no overlay to run.",
        links: [{ rel: "answers", to: "i5" }],
      }),
      item("i5", "question", "answered", { owner: "you" }),
      item("i6", "topic", "done"),
      item("i7", "task", "done", { parent: "i6" }),
      item("i8", "finding", "said", { parent: "i7" }),
    ],
    now: "i1",
    strip: { doing: "Adding the peering routes", waiting: ["i2"] },
    changes: [],
    sides: [],
    spend: { calls: 0, usd: 0, todayUsd: 0 },
    health: { following: true, behind: 0 },
  };
}

test("the whole outline leads with now, then the map with done topics folded", () => {
  const text = outline(view());
  const now = text.indexOf("## Now");
  const map = text.indexOf("## The whole map");
  assert.ok(now > 0 && map > now, "now comes before the map");
  const top = text.slice(now, map);
  assert.match(top, /Claude is on: Adding the peering routes/);
  assert.match(
    top,
    /### Waiting on you \(1\)\n- i2 ask \(waiting, yours\): ask i2 \(turn 2; in "topic i1"\)/,
  );
  assert.match(top, /### Open \(1\)\n- i3 task \(doing, Claude's\)/);
  assert.match(
    top,
    /### Decided \(1\)\n- i4 decision \(decided\): decision i4 \(turn 4; in "topic i1"\)\n {2}Peering needs no overlay to run\.\n {2}answers i5: question i5/,
  );
  const rest = text.slice(map);
  assert.match(
    rest,
    /### i6 · topic · done: topic i6 \(2 items, all settled; folded\)/,
  );
  assert.doesNotMatch(
    rest,
    /i7 · task/,
    "a folded topic's items are not listed",
  );
  assert.match(
    rest,
    /#### i2 · ask · waiting · yours: ask i2\nUnder: i1\n> said i2 \(turn 2\)/,
  );
  assert.match(
    rest,
    /#### i4 · decision · decided: decision i4\nUnder: i1\nPeering needs no overlay to run\.\n> said i4 \(turn 4\)\nanswers: i5 question i5/,
  );
});

test("a lens gives that section alone, and says when it is empty", () => {
  const v = view();
  const waiting = outline(v, "waiting");
  assert.match(
    waiting,
    /^# Networking: the map\nFiled up to turn 10 of 12\.\n\n### Waiting on you \(1\)\n- i2 /,
  );
  assert.doesNotMatch(waiting, /## Now|## The whole map|Open \(|Decided \(/);
  assert.match(outline(v, "decided"), /### Decided \(1\)\n- i4 /);
  v.items = v.items.filter((i) => !i.waiting);
  v.strip.waiting = [];
  assert.match(
    outline(v, "waiting"),
    /### Waiting on you \(0\)\nNothing waits on you\.\n$/,
  );
  assert.match(outline(v, "open"), /### Open \(1\)\n- i3 /);
  v.items = v.items.filter((i) => !i.open);
  assert.match(outline(v, "open"), /Nothing is open\.\n$/);
});

test("only the three lenses are read; anything else means the whole map", () => {
  assert.equal(outlineLens("waiting"), "waiting");
  assert.equal(outlineLens("decided"), "decided");
  assert.equal(outlineLens("all"), undefined);
  assert.equal(outlineLens(["waiting"]), undefined);
  assert.equal(outlineLens(undefined), undefined);
});
