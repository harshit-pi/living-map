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
  removeWire,
  restoreRemoved,
  updateComp,
  type DesignState,
} from "./core.ts";
import { named } from "./web/format.ts";

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
  // 30k reads over 12 nodes and 6k writes over 4 shards: a quarter of each
  // node on reads and half on writes
  updateComp(s, "db", { count: 3, shards: 4 });
  assert.equal(loadCheck(s).db.util, 0.75);
  assert.equal(loadCheck(s).db.status, "busy");
});

test("reads and writes share a part's capacity", () => {
  // a chat app: 4M reads and 3.5M writes a second through one service
  const s = build(
    [
      ["app", "client"],
      ["lb", "lb"],
      ["chat", "service"],
    ],
    [
      ["app", "lb"],
      ["lb", "chat"],
    ],
  );
  s.brief = { ...brief, reads: 4_000_000, writes: 3_500_000 };
  updateComp(s, "chat", { count: 800 });
  updateComp(s, "lb", { count: 20 });
  let load = loadCheck(s);
  assert.equal(load.chat.util, 1.88, "7.5M requests on 800 × 5k");
  assert.equal(load.chat.status, "over");
  assert.equal(load.lb.util, 1.88, "7.5M requests on 20 × 200k");
  // sized from the hint's ~5k requests/s, it fits
  updateComp(s, "chat", { count: 1600 });
  updateComp(s, "lb", { count: 40 });
  load = loadCheck(s);
  assert.equal(load.chat.status, "busy");
  assert.equal(load.lb.status, "busy");
  assert.match(
    outlineOf(s),
    /"chat" ×1600 — 4M reads\/s, 3\.5M writes\/s, capacity 8M requests\/s in all, 94% of capacity/,
  );
});

test("each client makes its own share of the brief, whatever it is wired to", () => {
  // YouTube: viewers make the plays, creators the uploads
  const s = build(
    [
      ["viewer", "client"],
      ["creator", "client"],
      ["cdn", "cdn"],
      ["api", "service"],
      ["videos", "blob"],
    ],
    [
      ["viewer", "cdn"],
      ["cdn", "videos"],
      ["creator", "api"],
      ["api", "videos"],
    ],
  );
  let load = loadCheck(s);
  assert.equal(load.creator.reads, 150_000, "no shares set: an even split");
  applyDesignOp(s, {
    op: "place",
    id: "viewer2",
    kind: "client",
    label: "TV app",
    readShare: 250,
    writeShare: "0",
  });
  assert.equal(s.comps.at(-1)?.readShare, 100, "a share is a percent");
  removeComp(s, "viewer2");
  updateComp(s, "viewer", { readShare: 100, writeShare: 0 });
  updateComp(s, "creator", { readShare: 0, writeShare: 100 });
  load = loadCheck(s);
  assert.deepEqual([load.viewer.reads, load.viewer.writes], [300_000, 0]);
  assert.deepEqual([load.creator.reads, load.creator.writes], [0, 6_000]);
  assert.equal(load.api.reads, 0, "the upload path carries no plays");
  assert.equal(load.videos.reads, 30_000, "the CDN's misses");
  assert.equal(load.videos.writes, 6_000);
  // wiring the creator straight to storage moves no plays with it
  connect(s, "creator", "videos");
  assert.equal(loadCheck(s).videos.reads, 30_000);
  // a client left unset takes what the others leave
  updateComp(s, "viewer", { readShare: 80 });
  delete s.comps.find((c) => c.id === "creator")!.readShare;
  assert.equal(loadCheck(s).creator.reads, 60_000);
  assert.match(outlineOf(s), /"creator", makes 20% of the brief.s reads/);
});

test("a cache fronts only the store it is wired to, and writes are not counted twice", () => {
  const s = build(
    [
      ["app", "client"],
      ["api", "service"],
      ["videos", "blob"],
      ["cache", "cache"],
      ["meta", "sql"],
    ],
    [
      ["app", "api"],
      ["api", "videos"],
      ["api", "meta"],
      ["api", "cache"],
      ["cache", "meta"],
    ],
  );
  const load = loadCheck(s);
  assert.equal(load.videos.reads, 300_000, "the video bytes keep their load");
  assert.equal(load.meta.reads, 30_000, "only the misses reach the database");
  assert.equal(load.meta.writes, 6_000, "written once, through the cache");
  assert.equal(load.videos.writes, 6_000);
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

test("a cycle is broken where traffic enters it, whatever order the parts were added in", () => {
  // b was added first, and the wire back from b closes the loop
  const s = build(
    [
      ["b", "service"],
      ["app", "client"],
      ["a", "service"],
    ],
    [
      ["app", "a"],
      ["a", "b"],
      ["b", "a"],
    ],
  );
  const load = loadCheck(s);
  assert.equal(load.a.reads, 300_000);
  assert.equal(load.b.reads, 300_000, "b is still fed by a");
  assert.equal(load.b.status, "over");
});

test("Undo puts a removed part back with its wires", () => {
  const s = build(
    [
      ["app", "client"],
      ["api", "service"],
      ["db", "sql"],
    ],
    [
      ["app", "api"],
      ["api", "db", { carries: "read", times: 3 }],
    ],
  );
  updateComp(s, "api", { count: 7 });
  removeComp(s, "api");
  removeComp(s, "db");
  assert.equal(s.wires.length, 0);
  assert.equal(
    restoreRemoved(s)?.comp?.id,
    "db",
    "the last removed comes back first",
  );
  assert.equal(
    s.wires.length,
    0,
    "its wire waits for the part at its other end",
  );
  assert.equal(restoreRemoved(s)?.comp?.count, 7);
  assert.deepEqual(
    s.wires.map((w) => [w.from, w.to, w.carries, w.times]),
    [
      ["app", "api", "both", 1],
      ["api", "db", "read", 3],
    ],
  );
  assert.equal(restoreRemoved(s), null, "nothing left to undo");
});

test("Undo puts a removed wire back as it was", () => {
  const s = build(
    [
      ["app", "client"],
      ["api", "service"],
    ],
    [["app", "api", { carries: "read", times: 10_000 }]],
  );
  const id = s.wires[0].id;
  assert.ok(removeWire(s, id));
  assert.equal(s.wires.length, 0);
  assert.deepEqual(
    restoreRemoved(s)?.wires.map((w) => [w.id, w.times]),
    [[id, 10_000]],
  );
  assert.equal(s.wires[0].carries, "read");
  assert.equal(restoreRemoved(s), null);
});

test("a second part of a kind gets its own name, and a stray id in Claude's text reads as it", () => {
  const s = newState();
  const a = addComp(s, "service", "", 0, 0)!;
  const b = addComp(s, "service", "", 0, 0)!;
  const c = addComp(s, "service", "Service", 0, 0)!;
  assert.deepEqual(
    [a, b, c].map((x) => [x.id, x.label]),
    [
      ["service", "Service"],
      ["service-2", "Service 2"],
      ["service-3", "Service 3"],
    ],
  );
  const cache = addComp(s, "cache", "Redis", 0, 0)!;
  assert.equal(
    named(
      `service-3 → service-2 carries no traffic; [${cache.id}] and the cache sit idle.`,
      s.comps,
    ),
    `"Service 3" → "Service 2" carries no traffic; "Redis" and the cache sit idle.`,
  );
  assert.equal(named(`"service-2" is idle`, s.comps), `"Service 2" is idle`);
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
