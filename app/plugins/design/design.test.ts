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
import { beside } from "./web/place.ts";
import { onWire, route, type Box } from "./web/route.ts";

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

test("a settled deep dive's next step replaces the review's, and takes the points it settles", () => {
  const s = newState();
  applyDesignOp(
    s,
    {
      op: "review",
      summary: "Resize first.",
      points: [
        { level: "fix", text: "Resize both services" },
        { level: "think", text: "Who orders two edits in one doc?" },
      ],
    },
    100,
  );
  assert.match(outlineOf(s), /\[1 fix\] Resize both services \[2 think\]/);
  assert.equal(
    applyDesignOp(
      s,
      {
        op: "next",
        text: "Resize both, then shard the op store.",
        settles: [2, "x", 9],
      },
      200,
    ),
    1,
  );
  assert.deepEqual(s.next, {
    at: 200,
    text: "Resize both, then shard the op store.",
  });
  assert.deepEqual(
    s.review?.points.map((p) => p.text),
    ["Resize both services"],
  );
  assert.match(outlineOf(s), /YOUR NEXT STEP SINCE: Resize both/);
  assert.equal(applyDesignOp(s, { op: "next", text: " " }), 0);
  // the next review is newer: it brings its own next step
  applyDesignOp(s, { op: "review", summary: "Better.", points: [] }, 300);
  assert.equal(s.next, null);
});

test("the outline gives load over capacity as the cards do, and says what the brief placed", () => {
  const s = newState();
  s.brief = { ...brief, reads: 2_000_000, writes: 1_000_000 };
  addComp(s, "client", "Docs editor", 0, 0, "claude", "app");
  addComp(s, "sql", "SQL database", 0, 0, "you", "db");
  connect(s, "app", "db");
  const out = outlineOf(s);
  assert.match(out, /"Docs editor", placed by you with the brief/);
  assert.match(
    out,
    /"SQL database" — 2M reads\/s, 1M writes\/s.*, 533x its capacity \(over\)/,
  );
  assert.doesNotMatch(out, /53333%/);
});

test("a wire keeps the dots you dragged it between", () => {
  const s = build(
    [
      ["app", "client"],
      ["lb", "lb"],
    ],
    [],
  );
  const w = connect(s, "app", "lb", "both", 1, "top", "right");
  assert.deepEqual([w?.fromSide, w?.toSide], ["top", "right"]);
  // a stray side is not kept, and half a pair is no pair
  const x = connect(s, "lb", "app", "both", 1, "middle", "left");
  assert.equal(x?.fromSide, undefined);
  assert.equal(x?.toSide, undefined);
  const boxes = new Map<string, Box>([
    ["app", { x: 400, y: 300 }],
    ["lb", { x: 0, y: 0 }],
  ]);
  assert.deepEqual(route(s.wires, boxes).get(w!.id), ["top", "right"]);
});

test("wires keep off a dot that carries one the other way, and off other cards", () => {
  // the news feed reference as laid out: the gateway's wire into the feed
  // service and the feed service's wire to its cache once shared a dot, and
  // the post service's wire to its store ran under the media store
  const at: [string, number, number][] = [
    ["gw", 232, 260],
    ["post-svc", 500, 380],
    ["feed-svc", 20, 380],
    ["media", 444, 500],
    ["post-cache", 20, 500],
    ["fanout-q", 242, 500],
    ["post-db", 399, 620],
    ["feed-cache", 131, 740],
  ];
  const boxes = new Map<string, Box>(
    at.map(([id, x, y]) => [id, { x, y, w: 172, h: 56 }]),
  );
  const wires = [
    ["gw", "post-svc"],
    ["gw", "feed-svc"],
    ["post-svc", "post-db"],
    ["post-svc", "media"],
    ["post-svc", "fanout-q"],
    ["feed-svc", "feed-cache"],
    ["feed-svc", "post-cache"],
    ["post-cache", "post-db"],
  ].map(([from, to]) => ({ id: `${from}>${to}`, from, to }));
  const r = route(wires, boxes);
  const ways = new Map<string, Set<string>>();
  for (const w of wires) {
    const [a, b] = r.get(w.id)!;
    for (const [k, way] of [
      [`${w.from}:${a}`, "out"],
      [`${w.to}:${b}`, "in"],
    ])
      ways.set(k, (ways.get(k) ?? new Set()).add(way));
  }
  for (const [dot, w] of ways) assert.ok(w.size === 1, `${dot} runs both ways`);
  assert.notDeepEqual(r.get("post-svc>post-db"), ["bottom", "top"]);
});

test("a new part is not put across a wire it is not on", () => {
  // the URL shortener: a wire runs up from the redirect service to the store
  const boxes = new Map<string, Box>([
    ["svc", { x: 0, y: 300, w: 172, h: 84 }],
    ["store", { x: 0, y: 0, w: 172, h: 84 }],
  ]);
  const wires = [
    { from: "svc", to: "store", sides: ["top", "bottom"] as ["top", "bottom"] },
  ];
  assert.equal(onWire({ x: 0, y: 150 }, wires, boxes), true, "across it");
  assert.equal(onWire({ x: 300, y: 150 }, wires, boxes), false, "beside it");
  assert.equal(onWire({ x: 0, y: 150 }, [], boxes), false, "no wires");
});

test("the inspector opens beside its part, or under or over it, never on it", () => {
  const panel = { w: 300, h: 280 };
  const room = { minLeft: 176, maxLeft: 460, minTop: 56, maxTop: 450 };
  const covers = (
    p: { left: number; top: number },
    c: { left: number; top: number; w: number; h: number },
  ) =>
    p.left < c.left + c.w &&
    p.left + panel.w > c.left &&
    p.top < c.top + c.h &&
    p.top + panel.h > c.top;
  // room on the right
  const lone = { left: 100, top: 200, w: 152, h: 72 };
  assert.deepEqual(beside(lone, panel, room), { left: 264, top: 200 });
  // room only on the left
  const far = { left: 600, top: 200, w: 152, h: 72 };
  assert.deepEqual(beside(far, panel, room), { left: 288, top: 200 });
  // the load balancer by the palette, with the review open: no room either
  // side, so it opens under the card, in sight
  const lb = { left: 332, top: 368, w: 152, h: 72 };
  const p = beside(lb, panel, room);
  assert.ok(!covers(p, lb), JSON.stringify(p));
  assert.deepEqual(p, { left: 332, top: 450 });
  // and over it when there is no room under it
  const low = { left: 332, top: 420, w: 152, h: 72 };
  assert.deepEqual(beside(low, panel, room), { left: 332, top: 128 });
  // a wire's midpoint: right of it, or left when that would cover it
  const mid = { left: 600, top: 200, w: 0, h: 0 };
  assert.deepEqual(beside(mid, panel, room), { left: 288, top: 200 });
});
