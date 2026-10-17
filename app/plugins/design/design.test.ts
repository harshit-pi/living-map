// Design's pure logic: the load check's rules of thumb and the cleaning of
// the model's ops.

import assert from "node:assert/strict";
import { test } from "vitest";

import {
  addComp,
  applyDesignOp,
  connect,
  loadCheck,
  newState,
  outlineOf,
  removeComp,
  updateComp,
  type DesignState,
} from "./core.ts";

const brief = {
  title: "Twitter",
  goals: [],
  constraints: [],
  scale: [],
  reads: 300_000,
  writes: 6_000,
};

function build(
  parts: [string, string][],
  wires: [string, string, object?][],
): DesignState {
  const s = newState();
  s.brief = brief;
  for (const [id, kind] of parts) addComp(s, kind, id, 0, 0, "you", id);
  for (const [a, b, o] of wires) {
    const w = connect(s, a, b);
    if (w && o) Object.assign(w, o);
  }
  return s;
}

test("one database behind the service falls over under timeline reads", () => {
  const s = build(
    [
      ["app", "client"],
      ["lb", "lb"],
      ["api", "service"],
      ["db", "sql"],
    ],
    [
      ["app", "lb"],
      ["lb", "api"],
      ["api", "db"],
    ],
  );
  const load = loadCheck(s);
  assert.equal(load.db.reads, 300_000);
  assert.equal(load.db.status, "over");
  assert.equal(load.api.status, "over", "one service instance takes 5k/s");
  updateComp(s, "api", { count: 100 });
  assert.equal(loadCheck(s).api.status, "ok");
});

test("a cache beside the database leaves it only the misses", () => {
  const s = build(
    [
      ["app", "client"],
      ["api", "service"],
      ["cache", "cache"],
      ["db", "sql"],
    ],
    [
      ["app", "api"],
      ["api", "cache"],
      ["api", "db"],
    ],
  );
  updateComp(s, "api", { count: 100 });
  const load = loadCheck(s);
  assert.equal(load.cache.reads, 300_000);
  assert.equal(load.db.reads, 30_000, "90% of reads stop at the cache");
  assert.equal(load.db.writes, 6_000, "writes still reach the store");
  assert.equal(load.db.status, "over");
  updateComp(s, "db", { count: 3, shards: 2 });
  assert.equal(loadCheck(s).db.status, "busy");
});

test("replicas add reads but only shards add writes", () => {
  const s = build(
    [
      ["app", "client"],
      ["db", "sql"],
    ],
    [["app", "db"]],
  );
  s.brief = { ...brief, reads: 0, writes: 9_000 };
  updateComp(s, "db", { count: 10 });
  assert.equal(loadCheck(s).db.status, "over");
  updateComp(s, "db", { shards: 5 });
  assert.equal(loadCheck(s).db.status, "ok");
});

test("a router splits traffic; fan-out multiplies it; a queue turns overload into backlog", () => {
  const s = build(
    [
      ["app", "client"],
      ["lb", "lb"],
      ["a", "service"],
      ["b", "service"],
      ["q", "queue"],
      ["fan", "worker"],
      ["feeds", "cache"],
    ],
    [
      ["app", "lb"],
      ["lb", "a"],
      ["lb", "b"],
      ["a", "q", { carries: "write" }],
      ["q", "fan"],
      ["fan", "feeds", { times: 200 }],
    ],
  );
  const load = loadCheck(s);
  assert.equal(load.a.reads, 150_000);
  assert.equal(load.b.reads, 150_000);
  assert.equal(load.q.reads, 0, "a write-only wire carries no reads");
  assert.equal(
    load.feeds.writes,
    3_000 * 200,
    "each tweet is written to 200 feeds",
  );
  assert.equal(
    load.feeds.status,
    "backlog",
    "behind a queue, overload waits instead of failing",
  );
});

test("cycles do not loop forever, and removing a part drops its wires", () => {
  const s = build(
    [
      ["app", "client"],
      ["a", "service"],
      ["b", "service"],
    ],
    [
      ["app", "a"],
      ["a", "b"],
      ["b", "a"],
    ],
  );
  assert.ok(loadCheck(s).b.reads > 0);
  removeComp(s, "b");
  assert.equal(s.wires.length, 1);
});

test("the model's ops are cleaned: unknown kinds, bad ids and stray points are dropped", () => {
  const s = newState();
  assert.equal(
    applyDesignOp(s, {
      op: "brief",
      title: "Design Twitter",
      reads: "300000",
      writes: 6000,
      goals: ["post tweets", 7],
    }),
    1,
  );
  assert.deepEqual(s.brief?.goals, ["post tweets"]);
  assert.equal(
    applyDesignOp(s, {
      op: "place",
      id: "app",
      kind: "client",
      label: "Phone app",
    }),
    1,
  );
  assert.equal(applyDesignOp(s, { op: "place", kind: "spaceship" }), 0);
  assert.equal(
    applyDesignOp(s, { op: "add", id: "x" }),
    null,
    "core's ops are not Design's",
  );
  applyDesignOp(s, {
    op: "reference",
    comps: [
      { id: "lb", kind: "lb" },
      { id: "__proto__", kind: "cache" },
      { id: "db", kind: "sql", label: "Tweets" },
    ],
    wires: [
      { from: "lb", to: "db" },
      { from: "lb", to: "nowhere" },
    ],
  });
  assert.deepEqual(
    s.reference?.comps.map((c) => c.id),
    ["lb", "db"],
  );
  assert.equal(s.reference?.wires.length, 1);
  applyDesignOp(s, {
    op: "review",
    summary: "Close.",
    points: [
      { level: "fix", text: "Add a cache", on: ["app", "ghost"] },
      { text: "" },
    ],
  });
  assert.deepEqual(s.review?.points, [
    { level: "fix", text: "Add a cache", on: ["app"] },
  ]);
  assert.match(outlineOf(s), /REFERENCE DESIGN \(yours, hidden/);
});
