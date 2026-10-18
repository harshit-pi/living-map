// Explore's decision board, pure logic and actions with no model: cleaning the
// model's board ops, bringing older maps onto boards, the roll-up, Next,
// folding and tallies, what the model reads, and the moves you make.

import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyExploreOp,
  clip,
  clipLine,
  fillCells,
  isStale,
  needsFill,
  newState,
  fold,
  live,
  nextGap,
  openItems,
  outlineOf,
  peek,
  reconcile,
  rollup,
  SETTLE_SURE,
  shown,
  summaryOf,
  tally,
  viewOf,
  waitsOnYou,
} from "./core.ts";
import { parseDump, RUN1, RUN2 } from "./fixtures.ts";
import { explore } from "./server.ts";
import {
  isCheck,
  tooLong,
  YOURS,
  type ExploreState,
  type ExploreView,
  type RowView,
} from "./shared.ts";
import { frameOf, treeLayout } from "./web/treeLayout.ts";
import { makeCtx } from "../../server/actions/context.ts";
import type { Raw, StoredMap } from "../../server/core/types.ts";
import type { Engine, TurnOptions } from "../../server/engine.ts";
import { newMap } from "../../server/store.ts";
import type { MapNode } from "../../shared/model.ts";

type Nodes = Record<string, MapNode>;

const node = (
  id: string,
  parent: string | null,
  kind: MapNode["kind"],
  title: string,
  extra: Partial<MapNode> = {},
): MapNode => ({
  id,
  parent,
  kind,
  title,
  summary: "",
  detail: "",
  status:
    kind === "question" ? "open" : kind === "option" ? "proposed" : "info",
  by: "claude",
  updatedAt: 1,
  order: 0,
  ...extra,
});

// A fresh choice: keep as is, Postgres and DynamoDB, a fact under Postgres,
// and a second question with options of its own.
function boardNodes(): Nodes {
  const list = [
    node("q", null, "question", "Which DB?"),
    node("keep", "q", "option", "Keep the current DB"),
    node("pg", "q", "option", "Postgres"),
    node("dyn", "q", "option", "DynamoDB"),
    node("f-pg", "pg", "fact", "Postgres runs our joins"),
    node("q2", "q", "question", "Which host?"),
    node("h1", "q2", "option", "Self-host"),
    node("h2", "q2", "option", "Managed"),
  ];
  return Object.fromEntries(list.map((n, i) => [n.id, { ...n, order: i }]));
}

// Wants on the board: cost (must, kept), speed (matters, kept), a suggestion.
function withWants(nodes: Nodes) {
  const map = { nodes, data: {} as Record<string, unknown> };
  const s = live(map);
  for (const [id, weight] of [
    ["w-cost", "must"],
    ["w-speed", "matters"],
    ["w-sugg", "nice"],
  ])
    applyExploreOp(s, nodes, { op: "want", q: "q", id, title: id, weight });
  s.boards.q.rows[0].suggested = false;
  s.boards.q.rows[1].suggested = false;
  return { map, s };
}

// An engine that records the turns it is asked for and runs none of them;
// `busy` says every turn asked about is already queued or running.
// `reply` is what Claude says in the main conversation, as the engine
// records it.
function stub(map: StoredMap, { busy = false, reply = "" } = {}) {
  const turns: { action: string; opts: TurnOptions }[] = [];
  let pushes = 0;
  const engine = {
    state: { map, busy: false, working: null, waiting: [] },
    push: () => pushes++,
    turn: async (action: string, _s: unknown, opts: TurnOptions = {}) => {
      turns.push({ action, opts });
      if (reply && !opts.threadId)
        map.chat.push({
          role: "claude",
          text: reply,
          ts: Date.now(),
          ...(opts.nodeId ? { nodeId: opts.nodeId } : {}),
        });
      return {};
    },
    threadOf: (m: StoredMap, id?: string | null) =>
      id && m.threads[id] ? m.threads[id].messages : m.chat,
    openThread: (m: StoredMap, nodeId: string) => {
      const id = `t${Object.keys(m.threads).length + 1}`;
      m.threads[id] = {
        id,
        nodeId,
        title: "Thread",
        createdAt: Object.keys(m.threads).length,
        messages: [],
      };
      return id;
    },
    isQueuedOrRunning: () => busy,
  } as unknown as Engine;
  const ctx = makeCtx(engine, { model: "", effort: "" }, map);
  const run = (name: string, args: Raw = {}) =>
    explore.actions![name](ctx, args);
  return { turns, run, pushes: () => pushes };
}

function storedMap(nodes: Nodes): StoredMap {
  const m = newMap("Which DB?", "explore");
  m.nodes = nodes;
  return m;
}

const ex = (m: { data?: Record<string, unknown> }) =>
  m.data?.explore as ExploreState;

// ---------------------------------------------------------------- cleaning

test("bad ids, unknown marks or weights, and over-long text are dropped or cut", () => {
  const { map, s } = withWants(boardNodes());
  const n = map.nodes;
  const op = (o: Raw) => applyExploreOp(s, n, o);
  assert.equal(
    op({ op: "want", q: "q", id: "__proto__", title: "x", weight: "must" }),
    0,
  );
  assert.equal(
    op({ op: "want", q: "q", id: "w-x", title: "x", weight: "huge" }),
    0,
  );
  assert.equal(
    op({ op: "want", q: "nope", id: "w-x", title: "x", weight: "must" }),
    0,
  );
  assert.equal(
    op({ op: "cell", option: "pg", want: "w-cost", mark: "great" }),
    0,
  );
  assert.equal(
    op({
      op: "cell",
      option: "pg",
      want: "w-cost",
      mark: "better",
      sure: "very",
    }),
    0,
  );
  assert.equal(op({ op: "frame", q: "q", shape: "maybe" }), 0);
  assert.equal(
    op({ op: "against", option: "pg", text: "x", survives: "maybe" }),
    0,
  );
  assert.equal(op({ op: "add", id: "x" }), null, "core's ops pass through");
  assert.equal(Object.keys(s.boards.q.cells).length, 0);
  assert.ok(!Object.hasOwn(n, "__proto__") && !n["w-x"]);

  op({
    op: "want",
    q: "q",
    id: "w-long",
    title: "one two three four five six seven eight",
    weight: "nice",
  });
  assert.equal(n["w-long"].title, "one two three four five six");
  op({ op: "stand", q: "q", lead: "pg", line: "word ".repeat(40) });
  assert.equal(s.stand.q.line.split(" ").length, 20);
  op({
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "better",
    note: "a ".repeat(30),
    facts: ["f-pg"],
  });
  assert.equal(
    s.boards.q.cells["pg|w-cost"].claude?.note.split(" ").length,
    12,
  );
});

test("a cell on a suggestion, on a set-aside option or from another board writes nothing", () => {
  const { map, s } = withWants(boardNodes());
  map.nodes.dyn.dropped = true;
  map.nodes.dyn.status = "dropped";
  const op = (o: Raw) => applyExploreOp(s, map.nodes, o);
  assert.equal(
    op({ op: "cell", option: "pg", want: "w-sugg", mark: "better" }),
    0,
  );
  assert.equal(
    op({ op: "cell", option: "dyn", want: "w-cost", mark: "better" }),
    0,
  );
  assert.equal(
    op({ op: "cell", option: "h1", want: "w-cost", mark: "better" }),
    0,
  );
  assert.deepEqual(s.boards.q.cells, {});
});

test("a cell is Claude's side only: your rating stays and Claude's sits beside it", async () => {
  const m = storedMap(boardNodes());
  const { run } = stub(m);
  m.data = { explore: withWants(m.nodes).s };
  await run("rate", {
    option: "pg",
    want: "w-cost",
    mark: "worse",
    note: "too dear",
  });
  const s = live(m);
  applyExploreOp(s, m.nodes, {
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "better",
    facts: ["f-pg"],
    sure: "high",
  });
  const cell = s.boards.q.cells["pg|w-cost"];
  assert.equal(cell.you?.mark, "worse");
  assert.equal(cell.claude?.mark, "better");
  const sc = shown(cell);
  assert.equal(sc?.who, "you", "yours wins on the board");
  assert.equal(sc?.claude?.mark, "better");
});

test("a cell with no facts behind it is stored sure low and shows as a guess", () => {
  const { map, s } = withWants(boardNodes());
  applyExploreOp(s, map.nodes, {
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "same",
    sure: "high",
    facts: ["nope", "__proto__"],
  });
  const c = s.boards.q.cells["pg|w-cost"].claude!;
  assert.deepEqual(c.facts, []);
  assert.equal(c.sure, "low");
  assert.equal(shown(s.boards.q.cells["pg|w-cost"])?.guess, true);
});

test("a want makes a fact node, adopts an existing fact, never changes yours, and caps at 12", () => {
  const nodes = boardNodes();
  nodes["ops-fact"] = node(
    "ops-fact",
    "q",
    "fact",
    "Ops capacity is the constraint",
    { order: 20 },
  );
  const map = { nodes, data: {} as Record<string, unknown> };
  const s = live(map);
  const op = (o: Raw) => applyExploreOp(s, nodes, o, { now: 7 });
  assert.equal(
    op({ op: "want", q: "q", id: "w-cost", title: "Cost", weight: "must" }),
    1,
  );
  assert.deepEqual(
    { ...nodes["w-cost"], order: 0 },
    {
      id: "w-cost",
      parent: "q",
      kind: "fact",
      title: "Cost",
      summary: "Claude's suggested want · must",
      detail: "",
      status: "info",
      by: "claude",
      updatedAt: 7,
      order: 0,
      fresh: true,
    },
  );
  assert.deepEqual(s.boards.q.rows[0], {
    id: "w-cost",
    weight: "must",
    suggested: true,
    by: "claude",
  });
  // a fact already on the map becomes the row
  assert.equal(
    op({ op: "want", q: "q", id: "ops-fact", title: "Ops", weight: "matters" }),
    1,
  );
  assert.equal(nodes["ops-fact"].title, "Ops capacity is the constraint");
  assert.equal(s.boards.q.rows[1].id, "ops-fact");
  // a fact under another node is not adopted
  assert.equal(
    op({ op: "want", q: "q", id: "f-pg", title: "x", weight: "nice" }),
    0,
  );
  // a row you kept is yours
  s.boards.q.rows[0].suggested = false;
  s.boards.q.rows[0].by = "you";
  assert.equal(
    op({ op: "want", q: "q", id: "w-cost", title: "Price", weight: "nice" }),
    0,
  );
  assert.equal(s.boards.q.rows[0].weight, "must");
  assert.equal(nodes["w-cost"].title, "Cost");
  // a suggestion of Claude's it may still reword
  assert.equal(
    op({ op: "want", q: "q", id: "ops-fact", title: "x", weight: "must" }),
    1,
  );
  assert.equal(s.boards.q.rows[1].weight, "must");
  for (let i = 0; i < 20; i++)
    op({
      op: "want",
      q: "q",
      id: `w-${i}`,
      title: `Want ${i}`,
      weight: "nice",
    });
  assert.equal(s.boards.q.rows.length, 12);
  assert.ok(!nodes["w-15"], "no node is made past the cap");
});

test("a stand never leads with a set-aside option, and its sure is clamped", () => {
  const nodes = boardNodes();
  nodes.dyn.dropped = true;
  const map = { nodes, data: {} as Record<string, unknown> };
  const s = live(map);
  applyExploreOp(s, nodes, {
    op: "stand",
    q: "q",
    lead: "dyn",
    line: "x",
    sure: 150,
  });
  assert.equal(s.stand.q.lead, null);
  assert.equal(s.stand.q.sure, 100);
  applyExploreOp(s, nodes, {
    op: "stand",
    q: "q",
    lead: "h1",
    line: "x",
    sure: -5,
  });
  assert.equal(
    s.stand.q.lead,
    null,
    "an option of another question cannot lead",
  );
  assert.equal(s.stand.q.sure, 0);
  applyExploreOp(s, nodes, {
    op: "stand",
    q: "q",
    lead: "pg",
    line: "x",
    sure: "65",
  });
  assert.equal(s.stand.q.lead, "pg");
  assert.equal(s.stand.q.sure, 65);
  assert.equal(
    applyExploreOp(s, nodes, { op: "stand", q: "pg", lead: null, line: "x" }),
    0,
  );
});

test("a case against keeps its history: at most 5, newest last", () => {
  const nodes = boardNodes();
  const s = live({ nodes, data: {} });
  for (let i = 1; i <= 7; i++)
    applyExploreOp(
      s,
      nodes,
      {
        op: "against",
        option: "pg",
        text: `reason ${i}`,
        survives: "narrowly",
      },
      { now: i },
    );
  assert.deepEqual(
    s.boards.q.against.pg.map((a) => a.text),
    ["reason 3", "reason 4", "reason 5", "reason 6", "reason 7"],
  );
});

test("a move files a node elsewhere, but never into itself, the root, yours or out of its thread", () => {
  const nodes = parseDump(RUN1);
  const map = { nodes, data: {} as Record<string, unknown> };
  const s = live(map);
  const op = (o: Raw, scope: string | null = null) =>
    applyExploreOp(s, nodes, o, { scope });
  assert.equal(
    op({ op: "move", id: "hybrid", parent: "dp-snapshot" }),
    0,
    "yours",
  );
  assert.equal(op({ op: "move", id: "root", parent: "t-cost" }), 0, "the root");
  assert.equal(
    op({ op: "move", id: "q-trigger", parent: "t-cost" }),
    0,
    "into its own subtree",
  );
  assert.equal(
    op({ op: "move", id: "c-opt-stay", parent: "c-soc2-timing" }),
    0,
    "under a fact",
  );
  assert.equal(
    op({ op: "move", id: "c-opt-stay", parent: "t-limits" }, "t-compliance"),
    0,
    "out of its thread",
  );
  // run 1 filed "SOC 2 on Heroku first" under a yes/no question; it belongs
  // under the question of how to get SOC 2
  nodes["t-soc2-path"] = node(
    "t-soc2-path",
    "q-trigger",
    "question",
    "How do we get SOC 2?",
    { order: 99 },
  );
  assert.equal(
    op({ op: "move", id: "c-opt-stay", parent: "t-soc2-path" }, "q-trigger"),
    1,
  );
  assert.equal(nodes["c-opt-stay"].parent, "t-soc2-path");
  const after = live(map);
  assert.ok(after.boards["t-soc2-path"], "its new question is a board");
  assert.equal(
    after.stand["t-compliance"].lead,
    null,
    "the old lead points nowhere now",
  );
});

test("a frame is refused in a thread and once you set the shape", () => {
  const nodes = boardNodes();
  const s = live({ nodes, data: {} });
  assert.equal(
    applyExploreOp(
      s,
      nodes,
      { op: "frame", q: "q", shape: "open" },
      { scope: "q" },
    ),
    0,
  );
  assert.equal(
    applyExploreOp(s, nodes, {
      op: "frame",
      q: "q",
      shape: "choose",
      keepAsIs: "pg",
    }),
    1,
  );
  assert.equal(s.boards.q.keepAsIs, "pg");
  s.boards.q.shapeBy = "you";
  assert.equal(
    applyExploreOp(s, nodes, { op: "frame", q: "q", shape: "causes" }),
    0,
  );
  assert.equal(s.boards.q.shape, "choose");
});

test("the wrap ops need a choice, and hold to 3 reasons, 5 assumptions and 5 steps", () => {
  const nodes = boardNodes();
  const map = { nodes, data: {} as Record<string, unknown> };
  let s = live(map);
  const op = (o: Raw) => applyExploreOp(s, nodes, o);
  assert.equal(op({ op: "premortem", option: "pg", reasons: ["a"] }), 0);
  assert.equal(op({ op: "assume", q: "q", id: "a-1", text: "x" }), 0);
  assert.equal(op({ op: "step", q: "q", id: "s-1", do: "x" }), 0);
  nodes.pg.status = "chosen";
  s = live(map); // the choice is carried onto the board
  assert.ok(s.boards.q.commit);
  assert.equal(
    op({ op: "premortem", option: "dyn", reasons: ["a"] }),
    0,
    "not the chosen one",
  );
  op({ op: "premortem", option: "pg", reasons: ["a", "b", "c", "d", "e"] });
  assert.deepEqual(s.boards.q.commit?.premortem.claude, ["a", "b", "c"]);
  for (let i = 0; i < 8; i++) {
    op({
      op: "assume",
      q: "q",
      id: `a-${i}`,
      text: `holds ${i}`,
      breaksIf: "x",
      status: "broken",
    });
    op({ op: "step", q: "q", id: `s-${i}`, when: "when x", do: `do ${i}` });
  }
  assert.equal(s.boards.q.assumptions.length, 5);
  assert.equal(s.boards.q.steps.length, 5);
  assert.ok(
    s.boards.q.assumptions.every((a) => a.status === "untested"),
    "Claude never says one held",
  );
  // yours stays yours
  s.boards.q.assumptions[0].by = "you";
  assert.equal(op({ op: "assume", q: "q", id: "a-0", text: "rewritten" }), 0);
  assert.equal(s.boards.q.assumptions[0].text, "holds 0");
});

test("a thread writes only its own column, its own row, or takeaways and moves under its node", () => {
  const { map, s } = withWants(boardNodes());
  const n = map.nodes;
  const op = (o: Raw, scope: string) => applyExploreOp(s, n, o, { scope });
  const cell = (option: string, want: string) => ({
    op: "cell",
    option,
    want,
    mark: "better",
    facts: ["f-pg"],
  });
  // an option's thread
  assert.equal(op(cell("pg", "w-cost"), "pg"), 1);
  // another column only on a fact filed under the thread's option (what you
  // told it about yourself), never on another board
  assert.equal(op({ ...cell("dyn", "w-cost"), facts: [] }, "pg"), 0);
  assert.equal(op({ ...cell("dyn", "w-cost"), facts: ["q2"] }, "pg"), 0);
  assert.equal(op(cell("dyn", "w-cost"), "pg"), 1);
  assert.equal(op(cell("h1", "w-cost"), "pg"), 0);
  assert.equal(op({ op: "against", option: "pg", text: "slow" }, "pg"), 1);
  assert.equal(op({ op: "against", option: "dyn", text: "slow" }, "pg"), 0);
  assert.equal(op({ op: "stand", q: "q", lead: "pg", line: "x" }, "pg"), 1);
  assert.equal(op({ op: "stand", q: "q2", lead: null, line: "x" }, "pg"), 0);
  assert.equal(
    op({ op: "want", q: "q", id: "w-new", title: "x", weight: "nice" }, "pg"),
    0,
  );
  assert.equal(op({ op: "frame", q: "q", shape: "open" }, "pg"), 0);
  // a want's thread
  assert.equal(op(cell("dyn", "w-cost"), "w-cost"), 1);
  assert.equal(op(cell("dyn", "w-speed"), "w-cost"), 0);
  assert.equal(op({ op: "stand", q: "q", lead: null, line: "x" }, "w-cost"), 1);
  // any other node's thread
  assert.equal(op(cell("h1", "w-cost"), "q2"), 0);
  assert.equal(
    op({ op: "takeaway", node: "h1", text: "Managed wins" }, "q2"),
    1,
  );
  assert.equal(op({ op: "takeaway", node: "pg", text: "no" }, "q2"), 0);
  assert.equal(op({ op: "move", id: "h2", parent: "h1" }, "q2"), 1);
  assert.equal(op({ op: "move", id: "f-pg", parent: "q2" }, "q2"), 0);
});

// ---------------------------------------------------------------- reconcile

test("run 1 opens as boards: the choice, its commit, and its old Recommended: leads", () => {
  const nodes = parseDump(RUN1);
  const s = reconcile(undefined, nodes);
  assert.deepEqual(Object.keys(s.boards).sort(), [
    "h-data-path",
    "root",
    "t-compliance",
    "t-limits",
  ]);
  assert.equal(s.boards.root.shape, "choose");
  assert.equal(s.boards.root.keepAsIs, "stay-heroku");
  assert.deepEqual(s.boards.root.commit, {
    option: "hybrid",
    why: "",
    at: nodes.hybrid.updatedAt,
    migrated: true,
    premortem: { claude: [] },
  });
  assert.equal(s.stand["h-data-path"].lead, "dp-snapshot");
  assert.equal(
    s.stand["h-data-path"].line,
    "export needed tables to encrypted S3; job reads it, no live connection",
  );
  assert.equal(s.stand["t-compliance"].lead, "c-opt-stay");
  assert.equal(s.stand["t-limits"].lead, "l-gpu-aws");
  assert.ok(Object.values(s.stand).every((x) => x.migrated));
  assert.ok(
    Object.values(s.boards).every((b) => !b.rows.length),
    "no wants yet",
  );
});

test("run 2 opens as causes at the root, with the recovery a choice", () => {
  const s = reconcile(undefined, parseDump(RUN2));
  assert.equal(s.boards.root.shape, "causes");
  assert.equal(s.boards["q-organic-cause"].shape, "causes");
  assert.equal(s.boards["q-response"].shape, "choose");
  assert.equal(
    s.boards.root.commit,
    undefined,
    "marking a cause likely is no commit",
  );
});

test("removing an option or a want takes what points at it with it", () => {
  const { map, s } = withWants(boardNodes());
  const n = map.nodes;
  applyExploreOp(s, n, {
    op: "cell",
    option: "dyn",
    want: "w-cost",
    mark: "worse",
    facts: ["f-pg"],
  });
  applyExploreOp(s, n, {
    op: "cell",
    option: "pg",
    want: "w-speed",
    mark: "better",
    facts: ["f-pg"],
  });
  applyExploreOp(s, n, { op: "against", option: "dyn", text: "lock-in" });
  applyExploreOp(s, n, { op: "stand", q: "q", lead: "dyn", line: "x" });
  s.boards.q.lean = { option: "dyn", at: 1 };
  delete n.dyn;
  delete n["w-speed"];
  const after = reconcile(s, n);
  const b = after.boards.q;
  assert.deepEqual(Object.keys(b.cells), []);
  assert.equal(b.against.dyn, undefined);
  assert.equal(b.lean, undefined);
  assert.equal(after.stand.q.lead, null);
  assert.deepEqual(
    b.rows.map((r) => r.id),
    ["w-cost", "w-sugg"],
  );
});

test("reconcile is idempotent", () => {
  for (const dump of [RUN1, RUN2]) {
    const nodes = parseDump(dump);
    const once = reconcile(undefined, nodes);
    assert.deepEqual(reconcile(once, nodes), once);
  }
  const { map, s } = withWants(boardNodes());
  assert.deepEqual(
    reconcile(s, map.nodes),
    reconcile(reconcile(s, map.nodes), map.nodes),
  );
});

test("reading a map writes nothing to it: view, outline and summary", () => {
  for (const dump of [RUN1, RUN2]) {
    const m = storedMap(parseDump(dump));
    explore.view!(m);
    explore.outline!(m);
    explore.summary!(m);
    assert.equal(m.data, undefined, "an old map stays as it was on disk");
  }
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const before = structuredClone(m.data);
  explore.view!(m);
  explore.outline!(m);
  assert.deepEqual(m.data, before);
});

test("a map switched to Learn and back keeps its board, with no stale keys", () => {
  const { map, s } = withWants(boardNodes());
  const n = map.nodes;
  applyExploreOp(s, n, {
    op: "cell",
    option: "dyn",
    want: "w-cost",
    mark: "worse",
    facts: ["f-pg"],
  });
  applyExploreOp(s, n, { op: "takeaway", node: "f-pg", text: "joins matter" });
  const saved = structuredClone(s);
  // in Learn: steps added under the root, an option and a fact gone
  n["step-1"] = node("step-1", "q", "question", "What do you store?", {
    order: 30,
  });
  n["new-opt"] = node("new-opt", "q", "option", "SQLite", { order: 31 });
  delete n.dyn;
  delete n["f-pg"];
  const back = reconcile(saved, n);
  const ids = JSON.stringify(back);
  assert.doesNotMatch(ids, /"dyn|dyn\||f-pg/);
  assert.deepEqual(
    back.boards.q.rows.map((r) => r.id),
    ["w-cost", "w-speed", "w-sugg"],
  );
  const view = explore.view!({
    ...storedMap(n),
    data: { explore: back },
  }) as ExploreView;
  assert.ok(
    view.boards.q.columns.some((c) => c.id === "new-opt"),
    "a new option is a column",
  );
  assert.equal(Object.keys(view.boards.q.cells).length, 0, "with empty cells");
});

// ---------------------------------------------------------------- roll-up

test("run 1 is leaning, 2 of 7 settled, with three choices open", () => {
  const nodes = parseDump(RUN1);
  const s = reconcile(undefined, nodes);
  const r = rollup(s, nodes);
  assert.equal(r.state, "leaning");
  assert.equal(r.total, 7);
  assert.deepEqual(
    r.points
      .filter((p) => p.settled)
      .map((p) => p.id)
      .sort(),
    ["snap-freshness", "t-cost"],
  );
  const choices = openItems(s, nodes, r).find((i) => i.kind === "choice");
  assert.equal(choices?.count, 3);
  assert.deepEqual(
    r.points
      .filter((p) => p.shape === "choose" && p.open && p.id !== "root")
      .map((p) => p.id)
      .sort(),
    ["h-data-path", "t-compliance", "t-limits"],
  );
});

test("run 2 is open, 0 of 5 settled, with the question under a set-aside cause flagged", () => {
  const nodes = parseDump(RUN2);
  const s = reconcile(undefined, nodes);
  const r = rollup(s, nodes);
  assert.equal(r.state, "open");
  assert.equal(r.settled, 0);
  assert.equal(r.total, 5);
  assert.equal(
    r.points.find((p) => p.id === "q-signup-gating")?.underAside,
    "Measurement or tracking broke",
  );
  const q = openItems(s, nodes, r).find((i) => i.kind === "question");
  assert.match(q?.label ?? "", /4 questions \(1 under a set-aside/);
});

test("a question Claude answered with an option still proposed under it is not settled", () => {
  const nodes = boardNodes();
  const s = live({ nodes, data: {} });
  applyExploreOp(s, nodes, { op: "frame", q: "q2", shape: "open" });
  nodes.q2.status = "answered";
  assert.equal(
    rollup(s, nodes).points.find((p) => p.id === "q2")?.settled,
    false,
  );
  nodes.h1.status = "dropped";
  nodes.h2.status = "dropped";
  assert.equal(
    rollup(s, nodes).points.find((p) => p.id === "q2")?.settled,
    true,
  );
});

test("a cause is settled only when you settle it, and everything settled is decided", async () => {
  const m = storedMap(parseDump(RUN2));
  const { run } = stub(m);
  const settled = (id: string) =>
    rollup(peek(m), m.nodes).points.find((p) => p.id === id)?.settled;
  m.nodes.root.status = "answered";
  assert.equal(settled("root"), false, "Claude's answered is not yours");
  await run("settle", {
    q: "root",
    answer: "Fewer clicks from search results",
  });
  assert.equal(settled("root"), true);
  for (const q of ["q-organic-cause", "q-confirm-serp", "q-signup-gating"])
    await run("settle", { q, answer: "done" });
  assert.equal(rollup(peek(m), m.nodes).state, "leaning");
  await run("commit", { option: "opt-resp-bofu" });
  const r = rollup(peek(m), m.nodes);
  assert.equal(r.state, "decided");
  assert.equal(r.settled, 5);
});

// ---------------------------------------------------------------- Next

test("Next takes the first gap, rule by rule", () => {
  const nodes = boardNodes();
  const map = { nodes, data: {} as Record<string, unknown> };
  let s = live(map);
  const gap = () => nextGap((s = live(map)), nodes, "q");
  const op = (o: Raw) => applyExploreOp(live(map), nodes, o);

  // 0: no list of what you want (an older board): Claude suggests one
  assert.deepEqual(
    [gap().kind, gap().short],
    ["suggest", "Suggest what to weigh"],
  );
  // 1: wants but no cells
  op({ op: "want", q: "q", id: "w-cost", title: "Cost", weight: "must" });
  assert.deepEqual([gap().kind, gap().short], ["fill", "Fill the board"]);
  s.boards.q.rows[0].suggested = false;
  op({ op: "want", q: "q", id: "w-speed", title: "Speed", weight: "matters" });
  s = live(map);
  s.boards.q.rows[1].suggested = false;
  op({
    op: "cell",
    option: "keep",
    want: "w-cost",
    mark: "same",
    facts: ["f-pg"],
  });
  // a cell or two of yours leaves Fill the step while most of the board is
  // empty (QA round 6: one rating took Fill away for good)
  assert.equal(gap().kind, "fill");
  for (const o of ["keep", "pg", "dyn"])
    op({
      op: "cell",
      option: o,
      want: "w-speed",
      mark: "same",
      facts: ["f-pg"],
    });
  // 2: no keep-as-is in the running
  nodes.keep.dropped = true;
  assert.equal(gap().kind, "something");
  delete nodes.keep.dropped;
  // 3: a must still empty or a guess (Claude leads only an option it has
  // judged on every must, so a guess there). With no lead yet, the guesses
  // are Next's too, the lead's column first
  op({ op: "cell", option: "dyn", want: "w-cost", mark: "better" });
  let g = gap();
  assert.equal(g.kind, "ask");
  assert.equal(g.option, "pg");
  assert.equal(g.reason, "a must, still empty");
  op({ op: "cell", option: "pg", want: "w-cost", mark: "better" });
  g = gap();
  assert.equal(g.kind, "ask");
  assert.equal(g.want, "w-cost");
  assert.equal(g.reason, "a must, only a guess");
  // once Claude leads, an empty must still comes first; a guess no longer
  // holds the choice back (QA: Next went round the guesses and never came
  // to Decide): it is still open, in the Decide sheet
  op({ op: "stand", q: "q", lead: "dyn", line: "x" });
  delete live(map).boards.q.cells["pg|w-cost"];
  g = gap();
  assert.equal(g.option, "pg");
  assert.equal(g.reason, "a must, still empty");
  op({ op: "cell", option: "pg", want: "w-cost", mark: "better" });
  assert.ok(
    live(map).boards.q.cells["pg|w-cost"].claude,
    "the guess is on the board",
  );
  assert.equal(gap().kind, "against", "a guess does not hold Next back");
  // judged on facts, as the rest of this walk needs
  for (const o of ["dyn", "pg"])
    op({
      op: "cell",
      option: o,
      want: "w-cost",
      mark: "better",
      facts: ["f-pg"],
    });
  // 4: the lead has no case against
  g = gap();
  assert.equal(g.kind, "against");
  assert.equal(g.option, "dyn");
  // the label keeps the option (the server knows the move by it); the
  // button never names the option Claude prefers
  assert.match(g.label, /^Strongest case against "DynamoDB"/);
  assert.equal(g.short, "Case against the lead");
  op({ op: "against", option: "dyn", text: "lock-in" });
  // 5: an empty cell on a matters row
  delete live(map).boards.q.cells["dyn|w-speed"];
  g = gap();
  assert.equal(g.kind, "ask");
  assert.equal(g.want, "w-speed");
  for (const o of ["keep", "pg", "dyn"])
    op({
      op: "cell",
      option: o,
      want: "w-speed",
      mark: "same",
      facts: ["f-pg"],
    });
  // 5b: Claude leads, the musts are judged and the lead has its case
  // against: deciding is yours, for no move, and Next names no option
  g = gap();
  assert.deepEqual([g.kind, g.short], ["choose", "Decide…"]);
  assert.equal(g.option, undefined);
  assert.ok(YOURS.has(g.kind));
  // 6: a choice with no pre-mortem
  nodes.pg.status = "chosen";
  nodes.keep.status = "dropped";
  nodes.dyn.status = "dropped";
  g = gap();
  assert.deepEqual([g.kind, g.short], ["wrap", "How could it fail?"]);
  live(map).boards.q.commit!.premortem.claude = ["a"];
  // 7: an open choice elsewhere, with a board of its own: Next opens it
  // there, for no move (QA round 6: a move from here left it open)
  g = gap();
  assert.deepEqual([g.kind, g.q], ["open", "q2"]);
  assert.ok(YOURS.has(g.kind));
  assert.match(g.label, /^Open choice: Which host\?/);
  // 8: an open question
  nodes.h1.status = "chosen";
  nodes.h2.status = "dropped";
  nodes.q3 = node("q3", "q", "question", "Who runs backups?", { order: 40 });
  g = gap();
  assert.deepEqual([g.kind, g.q], ["question", "q3"]);
  assert.match(g.label, /^Open question/);
  assert.equal(g.short, "Next question");
  // 9: nothing open
  nodes.q3.status = "answered";
  assert.deepEqual([gap().kind, gap().short], ["sum", "Sum up"]);
});

test("Next suggests wants on a bare board, and deciding pays for no move", async () => {
  const m = storedMap(boardNodes());
  const { run, turns } = stub(m);
  // an older board with no list of what you want: Next asks Claude for one
  await run("next", { q: "q" });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].opts.label, "Suggesting what to weigh");
  const op = (o: Raw) => applyExploreOp(live(m), m.nodes, o);
  op({ op: "want", q: "q", id: "w-cost", title: "Cost", weight: "must" });
  op({ op: "want", q: "q", id: "w-speed", title: "Speed", weight: "matters" });
  for (const r of live(m).boards.q.rows) r.suggested = false;
  for (const o of ["keep", "pg", "dyn"])
    for (const w of ["w-cost", "w-speed"])
      op({ op: "cell", option: o, want: w, mark: "same", facts: ["f-pg"] });
  op({ op: "stand", q: "q", lead: "pg", line: "joins" });
  op({ op: "against", option: "pg", text: "ops load" });
  const g = nextGap(live(m), m.nodes, "q");
  assert.deepEqual([g.kind, g.short], ["choose", "Decide…"]);
  // the button never names an option, least of all Claude's lead
  for (const id of ["keep", "pg", "dyn"])
    assert.ok(!g.short.includes(m.nodes[id].title), g.short);
  // the choice is yours: Next from elsewhere starts no move for it
  const r = await run("next", { q: "q" });
  assert.match(String((r as { error?: string }).error), /Decide sheet/);
  assert.equal(turns.length, 1);
});

test("on run 1 after a Choose, Next never goes deeper than a choice open above", () => {
  const nodes = parseDump(RUN1);
  // a deeper open choice, first in order
  nodes["q-deep"] = node("q-deep", "dp-direct", "question", "Which TLS mode?", {
    order: -1,
  });
  nodes["o-a"] = node("o-a", "q-deep", "option", "verify-full", { order: -1 });
  nodes["o-b"] = node("o-b", "q-deep", "option", "require", { order: -1 });
  const s = reconcile(undefined, nodes);
  assert.equal(
    nextGap(s, nodes, "root").kind,
    "wrap",
    "the old choice has no pre-mortem",
  );
  s.boards.root.commit!.premortem.claude = ["Snapshot lags a real need"];
  const g = nextGap(s, nodes, "root");
  // a choice with a board: Next opens it there
  assert.equal(g.kind, s.boards[g.q] ? "open" : "question");
  assert.ok(["h-data-path", "t-compliance", "t-limits"].includes(g.q), g.q);
});

// ---------------------------------------------------------------- fold, tally

const rows = (spec: [string, RowView["weight"]][]): RowView[] =>
  spec.map(([id, weight]) => ({
    id,
    title: id,
    weight,
    by: "you",
    suggested: false,
  }));

test("musts never fold; NICE folds before MATTERS; a gap in a folded group shows", () => {
  const few = rows([
    ["m1", "must"],
    ["a1", "matters"],
    ["n1", "nice"],
  ]);
  assert.ok(fold(few, {}, ["o"]).every((g) => !g.folded));
  const ten = rows([
    ["m1", "must"],
    ["m2", "must"],
    ["m3", "must"],
    ["a1", "matters"],
    ["a2", "matters"],
    ["a3", "matters"],
    ["a4", "matters"],
    ["n1", "nice"],
    ["n2", "nice"],
    ["n3", "nice"],
  ]);
  const full = (ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [
        `o|${id}`,
        {
          you: {
            mark: "same" as const,
            note: "",
            facts: [],
            sure: "high" as const,
            at: 1,
          },
        },
      ]),
    );
  let g = fold(
    ten,
    full(["m1", "m2", "m3", "a1", "a2", "a3", "a4", "n1", "n2"]),
    ["o"],
  );
  assert.deepEqual(
    g.map((x) => [x.weight, x.folded]),
    [
      ["must", false],
      ["matters", false],
      ["nice", true],
    ],
  );
  assert.equal(g[2].gap, true, "n3 is empty");
  assert.equal(g[1].gap, false);
  const twelve = [
    ...ten,
    ...rows([
      ["a5", "matters"],
      ["a6", "matters"],
    ]),
  ];
  g = fold(twelve, {}, ["o"]);
  assert.deepEqual(
    g.map((x) => [x.weight, x.folded]),
    [
      ["must", false],
      ["matters", true],
      ["nice", true],
    ],
  );
  g = fold(twelve, {}, ["o"], ["matters"]);
  assert.equal(g[1].folded, false, "a group you opened stays open");
  const musts = rows(
    Array.from({ length: 10 }, (_, i) => [`m${i}`, "must"] as [string, "must"]),
  );
  assert.ok(fold(musts, {}, ["o"]).every((x) => !x.folded));
});

test("tallies count the shown marks, yours winning, and a fails on a must marks the column", () => {
  const { map, s } = withWants(boardNodes());
  const n = map.nodes;
  applyExploreOp(s, n, {
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "fails",
    facts: ["f-pg"],
  });
  s.boards.q.cells["pg|w-cost"].you = {
    mark: "better",
    note: "",
    facts: [],
    sure: "high",
    at: 2,
  };
  applyExploreOp(s, n, {
    op: "cell",
    option: "pg",
    want: "w-speed",
    mark: "worse",
    facts: ["f-pg"],
  });
  applyExploreOp(s, n, {
    op: "cell",
    option: "dyn",
    want: "w-cost",
    mark: "fails",
    facts: ["f-pg"],
  });
  const t = tally(s.boards.q, n);
  assert.deepEqual(
    {
      met: t.pg.mustsMet,
      musts: t.pg.musts,
      better: t.pg.better,
      worse: t.pg.worse,
      fails: t.pg.failsMust,
    },
    { met: 1, musts: 1, better: 1, worse: 1, fails: false },
  );
  assert.equal(t.dyn.failsMust, true);
  assert.equal(t.dyn.mustsMet, 0);
  assert.equal(t.keep.empty, 1);
});

// ---------------------------------------------------------------- outline

test("the outline lists gaps before cells, marks suggestions, shows your ratings, and never your lean", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run } = stub(m);
  const s = live(m);
  applyExploreOp(s, m.nodes, {
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "better",
    facts: ["f-pg"],
  });
  await run("rate", { option: "pg", want: "w-cost", mark: "worse" });
  await run("lean", { q: "q", option: "dyn", sure: 77 });
  const text = outlineOf(peek(m), m.nodes);
  const gaps = text.indexOf("EMPTY OR GUESS ON A MUST");
  assert.ok(gaps > 0 && gaps < text.indexOf("CELLS"));
  assert.match(text, /SUGGESTED, NOT KEPT \(do not fill\): \[w-sugg\]/);
  assert.match(
    text,
    /pg × w-cost: better · \[f-pg\] · claude mid · USER SAYS worse/,
  );
  assert.doesNotMatch(text, /lean|77/i);
  assert.ok(
    !m.notes.some((x) => /lean|77|DynamoDB/i.test(x)),
    "nor in the notes",
  );
});

// ---------------------------------------------------------------- actions

test("Choose on a choice sets the rest aside, records why, and asks for a pre-mortem", async () => {
  const m = storedMap(boardNodes());
  const { run, turns } = stub(m);
  await run("commit", { option: "pg", why: "joins", sure: 70 });
  assert.equal(m.nodes.pg.status, "chosen");
  assert.equal(m.nodes.dyn.status, "dropped");
  assert.equal(m.nodes.q.status, "answered");
  const c = ex(m).boards.q.commit!;
  assert.deepEqual(
    [c.option, c.why, c.sure, c.migrated],
    ["pg", "joins", 70, undefined],
  );
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0].opts.sections, ["wrap"]);
  assert.match(
    turns[0].action,
    /^WRAP: \[pg\] "Postgres" was chosen for \[q\]/,
  );
  assert.match(m.notes.join("\n"), /Why: "joins"\. How sure: 70%/);
  // core's Choose comes the same way
  await run("choose", { type: "choose", nodeId: "h1" });
  assert.equal(ex(m).boards.q2.commit?.option, "h1");
});

test("Choose on a cause marks it likely and sets nothing else aside", async () => {
  const m = storedMap(parseDump(RUN2));
  const { run, turns } = stub(m);
  await run("commit", { option: "opt-org-rank" });
  assert.equal(m.nodes["opt-org-rank"].status, "chosen");
  assert.equal(m.nodes["opt-org-serp"].status, "proposed");
  assert.equal(m.nodes["q-organic-cause"].status, "open");
  assert.equal(turns.length, 0, "no pre-mortem for a cause");
  assert.equal(
    rollup(peek(m), m.nodes).points.find((p) => p.id === "q-organic-cause")
      ?.settled,
    false,
  );
});

test("Fill keeps the open suggestions and sets filledAt; touching nothing is recorded", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run, turns } = stub(m);
  await run("fill", { q: "q" });
  const b = ex(m).boards.q;
  assert.ok(b.rows.every((r) => !r.suggested));
  assert.ok(b.filledAt);
  assert.equal(b.criteriaTouched, false);
  assert.deepEqual(turns[0].opts.sections, ["fill"]);
  assert.match(turns[0].action, /^FILL the board for \[q\]/);
  // wants touched before the first Fill are counted
  const m2 = storedMap(boardNodes());
  m2.data = { explore: withWants(m2.nodes).s };
  const two = stub(m2);
  await two.run("want", { q: "q", id: "w-sugg", keep: false });
  assert.equal(ex(m2).boards.q.criteriaTouched, true);
  assert.ok(!m2.nodes["w-sugg"], "a skipped suggestion of Claude's goes");
});

test("Ask opens the option's thread, then reuses it", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run, turns } = stub(m);
  const first = await run("ask", { option: "pg", want: "w-cost" });
  assert.ok(first.threadId);
  assert.equal(m.threads[first.threadId!].nodeId, "pg");
  const second = await run("ask", { option: "pg", want: "w-speed" });
  assert.equal(second.threadId, first.threadId);
  assert.equal(turns[0].opts.view, "thread");
  assert.equal(turns[0].opts.threadId, first.threadId);
  assert.match(turns[0].action, /^ASK CELL: judge \[pg\]/);
  assert.match(
    (await run("ask", { option: "pg", want: "w-sugg" })).error ?? "",
    /not on the board/,
  );
});

test("Settle makes the question answered and yours", async () => {
  const m = storedMap(boardNodes());
  const { run } = stub(m);
  await run("settle", { q: "q2", answer: "Managed" });
  assert.equal(m.nodes.q2.status, "answered");
  assert.equal(m.nodes.q2.by, "you");
  assert.deepEqual(
    { text: ex(m).answers.q2.text, by: ex(m).answers.q2.by },
    { text: "Managed", by: "you" },
  );
});

test("a lean is stored but never noted", async () => {
  const m = storedMap(boardNodes());
  const { run } = stub(m);
  await run("lean", { q: "q", option: "pg", sure: 60 });
  assert.equal(ex(m).boards.q.lean?.option, "pg");
  assert.equal(ex(m).boards.q.lean?.sure, 60);
  assert.deepEqual(m.notes, []);
  await run("lean", { q: "q", option: null });
  assert.equal(ex(m).boards.q.lean, undefined);
});

test("Next runs the turn of the gap it found, told why", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run, turns } = stub(m);
  await run("next", {});
  assert.match(
    turns[0].action,
    /^Next: Claude judges each option on what you want\. FILL/,
  );
  assert.equal(turns[0].opts.label, "Next: Fill the board");
});

// ---------------------------------------------------------------- QA round 1

test("Next skips a column that already fails a must, and an empty must beats a guess", () => {
  const nodes = boardNodes();
  const map = { nodes, data: {} as Record<string, unknown> };
  const op = (o: Raw) => applyExploreOp(live(map), nodes, o);
  for (const id of ["w-cost", "w-ops"])
    op({ op: "want", q: "q", id, title: id, weight: "must" });
  for (const r of live(map).boards.q.rows) r.suggested = false;
  const f = ["f-pg"];
  // keep is the lead and filled; dyn fails a must; pg has a guess and a gap
  op({ op: "stand", q: "q", lead: "keep", line: "x" });
  for (const w of ["w-cost", "w-ops"])
    op({ op: "cell", option: "keep", want: w, mark: "same", facts: f });
  op({ op: "cell", option: "dyn", want: "w-cost", mark: "fails", facts: f });
  op({ op: "cell", option: "pg", want: "w-cost", mark: "better" });
  // a new option, every must empty
  nodes.trim = node("trim", "q", "option", "Trim it", { order: 50 });
  let g = nextGap(live(map), nodes, "q");
  assert.equal(g.kind, "ask");
  assert.notEqual(g.option, "dyn", "dyn is out: it fails a must");
  assert.equal(g.reason, "a must, still empty");
  assert.equal(g.option, "pg", "column order among the empty ones");
  assert.equal(g.want, "w-ops");
  op({ op: "cell", option: "pg", want: "w-ops", mark: "same", facts: f });
  g = nextGap(live(map), nodes, "q");
  assert.deepEqual([g.option, g.reason], ["trim", "a must, still empty"]);
  for (const w of ["w-cost", "w-ops"])
    op({ op: "cell", option: "trim", want: w, mark: "same", facts: f });
  g = nextGap(live(map), nodes, "q");
  assert.deepEqual([g.option, g.reason], ["pg", "a must, only a guess"]);
  // a must the open list counts is never on a column that is out
  const open = openItems(live(map), nodes);
  assert.equal(
    open.find((o) => o.kind === "empty-must"),
    undefined,
  );
});

test("a tally counts the musts an option fails, not every fails", () => {
  const { map, s } = withWants(boardNodes());
  const n = map.nodes;
  const f = ["f-pg"];
  applyExploreOp(s, n, {
    op: "cell",
    option: "dyn",
    want: "w-cost",
    mark: "fails",
    facts: f,
  });
  applyExploreOp(s, n, {
    op: "cell",
    option: "dyn",
    want: "w-speed",
    mark: "fails",
    facts: f,
  });
  const t = tally(s.boards.q, n);
  assert.equal(t.dyn.mustsFailed, 1);
  assert.equal(t.dyn.fails, 2);
});

test("on a cause list, Next stays on the question until you settle it", async () => {
  const m = storedMap(parseDump(RUN2));
  const { run } = stub(m);
  // nothing marked likely below the root's causes but the chosen traffic one
  await run("settle", { q: "q-organic-cause", answer: "AI overviews" });
  await run("settle", { q: "q-confirm-serp", answer: "done" });
  await run("settle", { q: "q-signup-gating", answer: "no" });
  await run("commit", { option: "opt-resp-bofu" });
  const g = nextGap(peek(m), m.nodes);
  assert.equal(g.kind, "question", "the root cause list is still open");
  assert.equal(g.q, "root");
  assert.match(
    g.label,
    /^Confirm "Top-of-funnel traffic fell", then settle it/,
  );
  await run("settle", { q: "root", answer: "Traffic fell" });
  assert.equal(nextGap(peek(m), m.nodes).kind, "sum");
});

test("Next on a cause list asks for the fact that tells the causes apart", async () => {
  const m = storedMap(parseDump(RUN2));
  const { run, turns } = stub(m);
  // the choice under it is made, so the cause list is what is open
  await run("commit", { option: "opt-resp-bofu" });
  await run("next", { q: "q-organic-cause" });
  const last = turns.at(-1)!;
  assert.match(last.action, /CAUSES of \[q-organic-cause\]/);
  // the checks on the map are named, so none is added twice
  assert.match(last.opts.label ?? "", /^Next: Which check to run first/);
  assert.match(
    last.action,
    /Checks already on the map: \[fact-query-split\] "Split CTR by query intent", \[fact-serp-check\]/,
  );
  // with none, Claude looks for the fact that splits them
  for (const id of ["fact-query-split", "fact-serp-check"]) delete m.nodes[id];
  await run("next", { q: "q-organic-cause" });
  assert.match(turns.at(-1)!.opts.label ?? "", /^Next: Tell the causes apart/);
  assert.doesNotMatch(turns.at(-1)!.action, /Checks already on the map/);
});

test("Claude's wants are refused on a cause list, and a suggestion says it is one", () => {
  const m = storedMap(parseDump(RUN2));
  const s = live(m);
  const op = (q: string, id: string) =>
    applyExploreOp(s, m.nodes, {
      op: "want",
      q,
      id,
      title: id,
      weight: "must",
    });
  assert.equal(op("root", "w-size"), 0);
  assert.equal(m.nodes["w-size"], undefined);
  assert.equal(op("q-response", "w-volume"), 1);
  assert.equal(m.nodes["w-volume"].summary, "Claude's suggested want · must");
});

test("keeping or weighting a suggestion makes its summary yours", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run } = stub(m);
  await run("want", { q: "q", id: "w-sugg", weight: "must" });
  const row = ex(m).boards.q.rows.find((r) => r.id === "w-sugg")!;
  assert.deepEqual([row.suggested, row.weight, row.by], [false, "must", "you"]);
  assert.equal(m.nodes["w-sugg"].summary, "What you want · must");
});

test("a want you remove leaves no loose fact, and adding it again gives one want", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run } = stub(m);
  await run("want", { q: "q", id: "w-cost", remove: true });
  assert.equal(m.nodes["w-cost"], undefined);
  await run("want", { q: "q", title: "w-cost", weight: "nice" });
  assert.equal(
    Object.values(m.nodes).filter((x) => x.title === "w-cost").length,
    1,
  );
  // a fact under the question with the same name becomes the row again
  m.nodes["f-uptime"] = node("f-uptime", "q", "fact", "Uptime", { order: 60 });
  await run("want", { q: "q", title: "uptime", weight: "must" });
  assert.ok(ex(m).boards.q.rows.some((r) => r.id === "f-uptime"));
  assert.equal(
    Object.values(m.nodes).filter((x) => /uptime/i.test(x.title)).length,
    1,
  );
  assert.match(
    (await run("want", { q: "q", title: "Uptime" })).error ?? "",
    /already on the board/,
  );
  // a want can be renamed
  await run("want", { q: "q", id: "f-uptime", title: "Uptime above 99.9%" });
  assert.equal(m.nodes["f-uptime"].title, "Uptime above 99.9%");
});

test("your names keep up to 80 characters, cut between words", async () => {
  const m = storedMap(boardNodes());
  const { run } = stub(m);
  const long =
    "Must be able to run the entire database locally on a developer laptop with no internet connection";
  await run("want", { q: "q", title: long });
  const w = Object.values(m.nodes).find((x) => x.title.startsWith("Must be"))!;
  assert.ok(w.title.length <= 80);
  assert.match(w.title, /offline|laptop|internet/, "the constraint survives");
  assert.ok(long.startsWith(w.title) && !/\s$/.test(w.title));
  assert.equal(long[w.title.length], " ", "cut at a space");
  assert.equal(clip("abcdefghij", 5, 4), "abcd", "one long word is cut");
});

test("changing your choice drops Claude's after for the old one, and keeps yours", async () => {
  const m = storedMap(boardNodes());
  const { run } = stub(m);
  await run("commit", { option: "pg" });
  const s = live(m);
  applyExploreOp(s, m.nodes, {
    op: "assume",
    q: "q",
    id: "a-joins",
    text: "Joins stay few",
  });
  applyExploreOp(s, m.nodes, {
    op: "step",
    q: "q",
    id: "s-1",
    do: "Sketch queries",
  });
  await run("assume", { q: "q", text: "Team learns SQL" });
  await run("restore", { type: "restore", nodeId: "dyn" });
  await run("commit", { option: "dyn" });
  const b = ex(m).boards.q;
  assert.equal(b.commit?.option, "dyn");
  assert.deepEqual(
    b.assumptions.map((a) => a.text),
    ["Team learns SQL"],
  );
  assert.deepEqual(b.steps, []);
});

test("Restore gives Claude's option back to Claude; one you added stays yours", async () => {
  const m = storedMap(boardNodes());
  const { run } = stub(m);
  const mine = await run("option", { q: "q", title: "SQLite" });
  await run("commit", { option: "pg" });
  assert.equal(
    m.nodes.dyn.by,
    "you",
    "set aside by the choice: kept from Claude",
  );
  await run("restore", { type: "restore", nodeId: "dyn" });
  await run("restore", { type: "restore", nodeId: mine.nodeId });
  assert.equal(m.nodes.dyn.status, "proposed");
  assert.equal(m.nodes.dyn.by, "claude");
  assert.equal(m.nodes[mine.nodeId!].by, "you");
  const cols = viewOf(peek(m), m.nodes, m.threads).boards.q.columns;
  assert.equal(cols.find((c) => c.id === "dyn")?.by, "claude");
  assert.equal(
    cols.find((c) => c.id === "pg")?.by,
    "claude",
    "chosen, not added",
  );
  assert.equal(cols.find((c) => c.id === mine.nodeId)?.by, "you");
});

test("an empty message runs no turn", async () => {
  const m = storedMap(boardNodes());
  const { run, turns } = stub(m);
  for (const text of [123, "", "   "])
    assert.match((await run("message", { text })).error ?? "", /Say something/);
  assert.equal(turns.length, 0);
  assert.deepEqual(m.chat, []);
});

test("Fill says it kept the open suggestions, names every want, and runs once", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run, turns } = stub(m);
  await run("fill", { q: "q" });
  assert.match(
    m.notes.join("\n"),
    /Pressing Fill kept Claude's suggestions "w-sugg" as what you want/,
  );
  assert.equal(m.nodes["w-sugg"].summary, "What you want · nice");
  assert.match(
    turns[0].action,
    /Write these 9 cells: \[keep\] × \[w-cost\] must, \[pg\] × \[w-cost\] must, \[dyn\] × \[w-cost\] must, \[keep\] × \[w-speed\] matters,.* That is every empty cell\./,
  );
  // a second press while a fill is queued or running pays for nothing
  const m2 = storedMap(boardNodes());
  m2.data = { explore: withWants(m2.nodes).s };
  const two = stub(m2, { busy: true });
  await two.run("fill", { q: "q" });
  assert.equal(two.turns.length, 0);
  assert.ok(!ex(m2).boards.q.filledAt);
});

test("Next asks once on a guess Claude checked in a thread, and again only after a newer fact", () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  for (const o of ["keep", "pg", "dyn"])
    for (const w of ["w-cost", "w-speed"])
      applyExploreOp(s, nodes, {
        op: "cell",
        option: o,
        want: w,
        mark: "same",
        facts: ["f-pg"],
      });
  const guess = { op: "cell", option: "pg", want: "w-cost" };
  applyExploreOp(s, nodes, { ...guess, mark: "better" }, { now: 100 });
  let g = nextGap(s, nodes, "q");
  assert.deepEqual([g.kind, g.option, g.want], ["ask", "pg", "w-cost"]);
  // Claude checks it in pg's thread and still cannot tell
  applyExploreOp(
    s,
    nodes,
    { ...guess, mark: "unknown", note: "a trial would tell" },
    { scope: "pg", now: 200 },
  );
  assert.equal(s.boards.q.cells["pg|w-cost"].claude?.checked, true);
  g = nextGap(s, nodes, "q");
  assert.ok(
    !(g.kind === "ask" && g.option === "pg" && g.want === "w-cost"),
    "Next moves on",
  );
  // still open, for you to rate
  assert.ok(openItems(s, nodes).some((o) => o.kind === "guess-must"));
  // a newer fact about one option that no cell on the want cites (what Go
  // deeper adds) is no reason to ask again
  nodes["f-risk"] = node("f-risk", "pg", "fact", "Risk: vendor lock-in", {
    updatedAt: 250,
    order: 59,
  });
  g = nextGap(s, nodes, "q");
  assert.ok(!(g.kind === "ask" && g.option === "pg" && g.want === "w-cost"));
  // a newer fact a cell on the same want cites is something to check it
  // against
  nodes["f-budget"] = node("f-budget", "dyn", "fact", "Budget $1,500/mo", {
    updatedAt: 300,
    order: 60,
  });
  applyExploreOp(
    s,
    nodes,
    {
      op: "cell",
      option: "dyn",
      want: "w-cost",
      mark: "worse",
      facts: ["f-budget"],
    },
    { now: 310 },
  );
  g = nextGap(s, nodes, "q");
  assert.deepEqual([g.kind, g.option, g.want], ["ask", "pg", "w-cost"]);
});

test("Next leaves a can't-tell to you, and checks keep-as-is after the other options", () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  // after a Fill: keep-as-is can't tell on the cost must; pg and dyn guess
  applyExploreOp(s, nodes, {
    op: "cell",
    option: "keep",
    want: "w-cost",
    mark: "unknown",
    note: "depends on your current setup",
  });
  for (const o of ["pg", "dyn"])
    applyExploreOp(s, nodes, {
      op: "cell",
      option: o,
      want: "w-cost",
      mark: "same",
      sure: "low",
    });
  let g = nextGap(s, nodes, "q");
  assert.deepEqual([g.kind, g.option, g.want], ["ask", "pg", "w-cost"]);
  // a new must: the options are asked before keep-as-is, which comes first
  // on the board
  assert.equal(s.boards.q.keepAsIs, "keep");
  s.boards.q.rows.find((r) => r.id === "w-speed")!.weight = "must";
  g = nextGap(s, nodes, "q");
  assert.deepEqual([g.kind, g.option, g.want], ["ask", "pg", "w-speed"]);
});

test("the open list counts empty cells, and on how many musts", () => {
  const { map, s } = withWants(boardNodes());
  const open = openItems(s, map.nodes);
  assert.equal(
    open.find((o) => o.kind === "empty-must")?.label,
    "3 empty cells on 1 must",
  );
});

test("a group of one row never folds: it would only hide the want", () => {
  const rows: RowView[] = [
    ...["m1", "m2"].map((id) => ({ id, weight: "must" as const })),
    ...["a", "b", "c", "d", "e", "f"].map((id) => ({
      id,
      weight: "matters" as const,
    })),
    { id: "n1", weight: "nice" as const },
  ].map((r) => ({ ...r, title: r.id, by: "you" as const, suggested: false }));
  const g = fold(rows, {}, []);
  assert.equal(g.find((x) => x.weight === "nice")?.folded, false);
  assert.equal(g.find((x) => x.weight === "matters")?.folded, true);
});

test("after you choose, Claude's lead stays its own until the board changes", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  applyExploreOp(live(m), m.nodes, {
    op: "cell",
    option: "dyn",
    want: "w-cost",
    mark: "same",
  });
  applyExploreOp(live(m), m.nodes, {
    op: "stand",
    q: "q",
    lead: "dyn",
    line: "DynamoDB scales",
    sure: 40,
  });
  const { run } = stub(m);
  await run("commit", { option: "pg", why: "joins" });
  applyExploreOp(live(m), m.nodes, {
    op: "stand",
    q: "q",
    lead: "pg",
    line: "Chosen",
    sure: 65,
  });
  assert.deepEqual([ex(m).stand.q.lead, ex(m).stand.q.sure], ["dyn", 40]);
  const v = viewOf(peek(m), m.nodes, m.threads);
  assert.ok(v.boards.q.columns.find((c) => c.id === "dyn")?.lead);
  // new evidence: now Claude may change its mind
  const later = Date.now() + 1000;
  const s = live(m);
  applyExploreOp(
    s,
    m.nodes,
    {
      op: "cell",
      option: "pg",
      want: "w-cost",
      mark: "better",
      facts: ["f-pg"],
    },
    { now: later },
  );
  applyExploreOp(
    s,
    m.nodes,
    { op: "stand", q: "q", lead: "pg", line: "It fits", sure: 70 },
    { now: later },
  );
  assert.deepEqual([ex(m).stand.q.lead, ex(m).stand.q.sure], ["pg", 70]);
});

test("an older map's after for an earlier choice goes when it is opened", () => {
  const nodes = boardNodes();
  nodes.pg.status = "chosen";
  for (const id of ["keep", "dyn"]) nodes[id].status = "dropped";
  const s = newState();
  const b = reconcile(s, nodes).boards.q;
  b.commit = { option: "pg", why: "", at: 500, premortem: { claude: [] } };
  const a = (id: string, by: "you" | "claude", at: number) => ({
    id,
    text: id,
    breaksIf: "",
    status: "untested" as const,
    by,
    at,
  });
  b.assumptions = [a("a-old", "claude", 100), a("a-new", "claude", 600)];
  b.assumptions.push(a("a-yours", "you", 50));
  b.steps = [
    { id: "s-old", when: "", do: "x", by: "claude", at: 100 },
    { id: "s-undated", when: "", do: "x", by: "claude" },
    { id: "s-new", when: "", do: "x", by: "claude", at: 700 },
  ];
  const r = reconcile({ ...s, boards: { q: b } }, nodes).boards.q;
  assert.deepEqual(
    r.assumptions.map((x) => x.id),
    ["a-new", "a-yours"],
  );
  assert.deepEqual(
    r.steps.map((x) => x.id),
    ["s-undated", "s-new"],
  );
});

test("a board's loose facts are its own: no checks, no wants, none from a question below", () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  nodes["f-host"] = node("f-host", "q2", "fact", "Managed costs more", {
    order: 70,
  });
  nodes["f-check"] = node("f-check", "pg", "fact", "Query plans", {
    summary: "To check: run EXPLAIN on the top queries",
    order: 71,
  });
  nodes["w-old"] = node("w-old", "q", "fact", "Old want", {
    summary: "What you want · must",
    order: 72,
  });
  const v = viewOf(s, nodes, {});
  assert.deepEqual(
    v.boards.q.looseFacts.map((f) => f.id),
    ["f-pg"],
  );
  assert.deepEqual(
    v.boards.q2.looseFacts.map((f) => f.id),
    ["f-host"],
  );
  assert.ok(v.wants.includes("w-old") && v.wants.includes("w-cost"));
  assert.ok(isCheck(nodes["f-check"]));
  assert.ok(isCheck(node("x", null, "fact", "Split churn by cohort")));
  assert.ok(!isCheck(node("y", null, "fact", "TikTok ads started August")));
});

test("Fill lists every empty must before any matters cell, at most 24, and says what is left", async () => {
  const nodes = boardNodes();
  // 9 options and 2 musts: 18 must cells, then what matters
  for (let i = 0; i < 6; i++)
    nodes[`o${i}`] = node(`o${i}`, "q", "option", `Option ${i}`, {
      order: 20 + i,
    });
  const m = storedMap(nodes);
  const { s } = withWants(m.nodes);
  m.data = { explore: s };
  applyExploreOp(s, m.nodes, {
    op: "want",
    q: "q",
    id: "w-safe",
    title: "w-safe",
    weight: "must",
  });
  s.boards.q.rows.at(-1)!.suggested = false;
  // one must cell is filled already: Fill leaves it
  applyExploreOp(s, m.nodes, {
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "same",
    facts: ["f-pg"],
  });
  const { run, turns } = stub(m);
  await run("fill", { q: "q" });
  const action = turns[0].action;
  const cells = [...action.matchAll(/\[([\w-]+)\] × \[([\w-]+)\] (\w+)/g)];
  assert.equal(cells.length, 24);
  const weights = cells.map((c) => c[3]);
  assert.equal(weights.filter((w) => w === "must").length, 17);
  assert.ok(
    weights.slice(0, 17).every((w) => w === "must"),
    "musts first",
  );
  assert.ok(!cells.some((c) => c[1] === "pg" && c[2] === "w-cost"));
  // 35 empty cells (4 wants, the suggestion kept): 11 left, and Claude is
  // told so
  assert.match(action, /11 more empty cells are left for later/);
});

test("an ask on a cell runs once while it waits, and its turn is by the option", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run, turns } = stub(m);
  await run("ask", { option: "pg", want: "w-cost" });
  assert.equal(turns[0].opts.nodeId, "pg");
  assert.match(turns[0].action, /Then a stand op for \[q\]/);
  const m2 = storedMap(boardNodes());
  m2.data = { explore: withWants(m2.nodes).s };
  const two = stub(m2, { busy: true });
  await two.run("ask", { option: "pg", want: "w-cost" });
  assert.equal(two.turns.length, 0);
  assert.equal(Object.keys(m2.threads).length, 0, "no thread, no message");
});

test("the stand says when the board scores another option higher on the musts", () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  const cell = (option: string, mark: string) =>
    applyExploreOp(s, nodes, {
      op: "cell",
      option,
      want: "w-cost",
      mark,
      facts: ["f-pg"],
    });
  cell("keep", "same");
  cell("pg", "worse");
  cell("dyn", "worse");
  applyExploreOp(s, nodes, { op: "stand", q: "q", lead: "pg", line: "x" });
  const says = () => viewOf(s, nodes, {}).stand.q.boardSays;
  assert.equal(
    says(),
    'the board has "Keep the current DB" meeting more musts (1/1, the lead 0/1)',
  );
  cell("pg", "fails");
  assert.equal(says(), "the board has it failing a must");
  cell("pg", "better");
  assert.equal(says(), undefined);
});

test("the open list names the board of a lead with no case against", () => {
  const { map, s } = withWants(boardNodes());
  applyExploreOp(s, map.nodes, { op: "frame", q: "q2", shape: "choose" });
  applyExploreOp(s, map.nodes, { op: "stand", q: "q2", lead: "h1", line: "x" });
  const item = () =>
    openItems(s, map.nodes).find((o) => o.kind === "no-against");
  assert.equal(item()?.label, '"Which host?": no case against its lead');
  assert.equal(item()?.q, "q2");
  applyExploreOp(s, map.nodes, {
    op: "against",
    option: "h1",
    text: "costly",
  });
  applyExploreOp(s, map.nodes, {
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "same",
  });
  applyExploreOp(s, map.nodes, { op: "stand", q: "q", lead: "pg", line: "x" });
  assert.equal(item()?.label, "no case against the lead");
});

test("a choice under a cause no one marked likely waits: Next tells the causes apart first", async () => {
  const m = storedMap(parseDump(RUN2));
  const { run } = stub(m);
  await run("commit", { option: "opt-resp-bofu" });
  await run("settle", { q: "root", answer: "Traffic fell" });
  // how to act on AI overviews, under that cause, still untested
  m.nodes["o-a"] = node("o-a", "q-confirm-serp", "option", "Act now");
  m.nodes["o-b"] = node("o-b", "q-confirm-serp", "option", "Wait");
  live(m).boards["q-confirm-serp"].shape = "choose";
  const g = nextGap(peek(m), m.nodes);
  assert.equal(g.kind, "question");
  assert.equal(g.q, "q-organic-cause");
  assert.match(g.label, /^Which check to run first/);
  assert.equal(g.short, "Pick a check");
  // once the cause is marked likely, its choice is Next's
  await run("commit", { option: "opt-org-serp" });
  assert.match(nextGap(peek(m), m.nodes).label, /^Open choice: How to confirm/);
});

test("Claude's pick of a check stays on the map, and Next hands it to you until something newer", async () => {
  const m = storedMap(parseDump(RUN2));
  const { run, turns } = stub(m);
  await run("commit", { option: "opt-resp-bofu" });
  await run("settle", { q: "root", answer: "Traffic fell" });
  await run("settle", { q: "q-confirm-serp", answer: "two checks" });
  await run("next", {});
  assert.match(turns.at(-1)!.action, /write a takeaway op on that check/);
  const s = live(m);
  applyExploreOp(
    s,
    m.nodes,
    {
      op: "takeaway",
      node: "fact-query-split",
      text: "Run first: brand CTR flat means AI overviews",
    },
    { now: Date.now() + 1000 },
  );
  let g = nextGap(peek(m), m.nodes);
  assert.deepEqual(
    [g.kind, g.q, g.option],
    ["run", "q-organic-cause", "fact-query-split"],
  );
  assert.match(g.label, /^Run "Split CTR by query intent", then say/);
  assert.match(g.reason, /brand CTR flat/);
  const v = viewOf(peek(m), m.nodes, m.threads);
  assert.equal(
    v.questions.find((q) => q.id === "q-organic-cause")?.runFirst?.id,
    "fact-query-split",
  );
  // pressing it on an older screen pays for nothing
  const before = turns.length;
  const r = await run("next", {});
  assert.ok("error" in r);
  assert.equal(turns.length, before);
  // what the check found is newer than the pick: the question is Next's again
  m.nodes["f-found"] = node(
    "f-found",
    "opt-org-serp",
    "fact",
    "Brand CTR flat",
    {
      updatedAt: Date.now() + 2000,
    },
  );
  g = nextGap(peek(m), m.nodes);
  assert.equal(g.kind, "question");
  assert.equal(g.q, "q-organic-cause");
});

test("Go deeper's reply is kept on the node's side thread", async () => {
  const m = storedMap(boardNodes());
  const { run } = stub(m, { reply: "I split it into three checks." });
  await run("deeper", { nodeId: "pg" });
  const th = Object.values(m.threads).find((x) => x.nodeId === "pg");
  assert.equal(th?.messages.at(-1)?.text, "I split it into three checks.");
});

test("a kept want is yours on the map too, so Claude cannot rename or remove it", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run } = stub(m);
  await run("want", { q: "q", id: "w-sugg", keep: true });
  assert.equal(m.nodes["w-sugg"].by, "you");
});

test("a pre-mortem runs once, and is told whether Claude's lead is the option chosen", async () => {
  const m = storedMap(boardNodes());
  applyExploreOp(live(m), m.nodes, {
    op: "stand",
    q: "q",
    lead: "dyn",
    line: "DynamoDB",
  });
  const { run, turns } = stub(m);
  await run("commit", { option: "pg" });
  assert.match(
    turns[0].action,
    /led \[dyn\] "DynamoDB", not the option chosen/,
  );
  assert.equal(turns[0].opts.label, 'How could "Postgres" fail?');
  // Next on it while the Choose's own waits or runs pays for nothing
  const m2 = storedMap(boardNodes());
  const two = stub(m2, { busy: true });
  await two.run("commit", { option: "pg" });
  await two.run("next", { q: "q" });
  assert.equal(two.turns.length, 0);
});

test("gaps are empty cells, apart from guesses and can't-tells", () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  for (const o of ["keep", "pg", "dyn"])
    applyExploreOp(s, nodes, {
      op: "cell",
      option: o,
      want: "w-cost",
      mark: o === "keep" ? "unknown" : "same",
      sure: "low",
    });
  // every cost cell is marked, so the maps list says what is open first
  // (a guess on every must), never "0 gaps"; speed is empty on all three
  assert.match(summaryOf(s, nodes), /· 3 guesses on 1 must$/);
  const t = tally(s.boards.q, nodes);
  assert.deepEqual([t.keep.unknown, t.keep.blank, t.keep.empty], [1, 1, 0]);
});

// ---------------------------------------------------------------- round 5

test("a must Claude can't tell without you is yours: Next opens it, and pays for no more asks on it", async () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  for (const o of ["keep", "pg", "dyn"])
    applyExploreOp(s, nodes, {
      op: "cell",
      option: o,
      want: "w-speed",
      mark: "same",
      facts: ["f-pg"],
    });
  // an Ask on pg's cost, in pg's thread: Claude still can't tell
  applyExploreOp(
    s,
    nodes,
    {
      op: "cell",
      option: "pg",
      want: "w-cost",
      mark: "unknown",
      note: "give me your budget",
    },
    { scope: "pg", now: 200 },
  );
  assert.deepEqual(
    waitsOnYou(nodes, s.boards.q, "must").map((w) => [w.want, w.option]),
    [["w-cost", "pg"]],
  );
  // the empty cost cells beside it would end the same way: no ask on them
  const g = nextGap(s, nodes, "q");
  assert.equal(g.kind, "tell");
  assert.equal(g.want, "w-cost");
  assert.match(g.label, /^Say what you know: w-cost$/);
  assert.match(g.reason, /give me your budget/);
  // pressed anyway (an older screen), it is no move
  const m = storedMap(nodes);
  m.data = map.data;
  const { run, turns } = stub(m);
  const r = await run("next", { q: "q" });
  assert.ok(r.error);
  assert.equal(turns.length, 0);
  // a fact of yours, newer than the can't-tell, is what Claude asked for
  nodes["f-budget"] = node("f-budget", "q", "fact", "Budget $2k/mo", {
    by: "you",
    updatedAt: Date.now() + 1000,
    order: 70,
  });
  assert.equal(nextGap(s, nodes, "q").kind, "ask");
});

test("can't tell on two options waits on you; on one, from a Fill, it does not", () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  const cell = (option: string, mark: string) =>
    applyExploreOp(s, nodes, { op: "cell", option, want: "w-cost", mark });
  cell("keep", "unknown");
  assert.equal(waitsOnYou(nodes, s.boards.q, "must").length, 0);
  cell("pg", "unknown");
  assert.equal(waitsOnYou(nodes, s.boards.q, "must")[0]?.want, "w-cost");
});

test("after a Choose, the open list still says what is unsure on the option chosen", async () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  applyExploreOp(s, nodes, {
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "unknown",
  });
  const m = storedMap(nodes);
  m.data = map.data;
  const { run } = stub(m);
  await run("commit", { option: "pg" });
  const open = openItems(peek(m), m.nodes);
  assert.equal(
    open.find((o) => o.kind === "chosen-unsure")?.label,
    "1 must unsure on your choice",
  );
});

test("on a cause list, a check answered after the stand makes the stand stale", () => {
  const nodes: Nodes = Object.fromEntries(
    [
      node("root", null, "question", "What could explain the AWS bill?"),
      node("c-az", "root", "option", "Cross-AZ traffic"),
      node("c-orphan", "root", "option", "Orphaned volumes"),
      node("chk", "c-az", "fact", "Cross-AZ usage", {
        summary: "To check: the usage type",
      }),
    ].map((n, i) => [n.id, { ...n, order: i, updatedAt: 10 }]),
  );
  const map = { nodes, data: {} as Record<string, unknown> };
  const s = live(map);
  applyExploreOp(s, nodes, { op: "frame", q: "root", shape: "causes" });
  applyExploreOp(
    s,
    nodes,
    { op: "stand", q: "root", lead: "c-az", line: "the check decides" },
    { now: 100 },
  );
  assert.equal(isStale(s, nodes, "root"), false);
  nodes.chk = { ...nodes.chk, summary: "Spiked on Oct 3", updatedAt: 200 };
  assert.equal(isStale(s, nodes, "root"), true);
});

// ---------------------------------------------------------------- round 6

test("Fill stays the step while most of the board is empty, and fills beside your own marks", () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  const b = () => s.boards.q;
  assert.ok(needsFill(nodes, b()));
  // you rate one cell yourself, as the banner asks
  s.boards.q.cells["pg|w-cost"] = {
    you: { mark: "same", note: "", facts: [], sure: "high", at: 1 },
  };
  assert.ok(b().cells["pg|w-cost"].you, "the mark is yours");
  assert.ok(needsFill(nodes, b()));
  assert.equal(nextGap(s, nodes, "q").kind, "fill");
  assert.ok(viewOf(s, nodes, {}).boards.q.needsFill);
  // a Fill writes Claude's side on it too: your mark stays, Claude's beside
  const { cells } = fillCells(nodes, b());
  assert.ok(cells.some((c) => c.option === "pg" && c.want === "w-cost"));
  assert.equal(cells.length, 6);
  // an option Claude adds with one cell of its own leaves Fill there too
  nodes.yb = node("yb", "q", "option", "YugabyteDB", { order: 50 });
  applyExploreOp(s, nodes, {
    op: "cell",
    option: "yb",
    want: "w-cost",
    mark: "same",
    facts: ["f-pg"],
  });
  assert.equal(nextGap(s, nodes, "q").kind, "fill");
  // once most cells have a mark, Next works cell by cell
  for (const o of ["keep", "pg", "dyn"])
    applyExploreOp(s, nodes, {
      op: "cell",
      option: o,
      want: "w-speed",
      mark: "same",
      facts: ["f-pg"],
    });
  assert.ok(!needsFill(nodes, b()));
  assert.notEqual(nextGap(s, nodes, "q").kind, "fill");
});

test("after a Choose, Next checks what is still unknown on the option chosen before it sums up", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const nodes = m.nodes;
  const s = live(m);
  for (const o of ["keep", "pg", "dyn"])
    applyExploreOp(s, nodes, {
      op: "cell",
      option: o,
      want: "w-cost",
      mark: "same",
      facts: ["f-pg"],
    });
  const { run } = stub(m);
  await run("commit", { option: "pg" });
  live(m).boards.q.commit!.premortem.claude = ["a"];
  // nothing chosen is settled at q2 yet: the chosen option's empty matters
  // cell still comes first, on this board
  const g = nextGap(peek(m), nodes, "q");
  assert.deepEqual([g.kind, g.option, g.want], ["ask", "pg", "w-speed"]);
  assert.match(g.reason, /your choice/);
  // the other columns are out: no ask on them
  applyExploreOp(live(m), nodes, {
    op: "cell",
    option: "pg",
    want: "w-speed",
    mark: "better",
    facts: ["f-pg"],
  });
  assert.notEqual(nextGap(peek(m), nodes, "q").kind, "ask");
});

test("Next on a choice with its own board opens it, and asked from elsewhere runs that board's step", async () => {
  const m = storedMap(boardNodes());
  m.data = { explore: withWants(m.nodes).s };
  const { run, turns } = stub(m);
  // q is decided, q2 is the choice still open
  await run("commit", { option: "pg" });
  live(m).boards.q.commit!.premortem.claude = ["a"];
  for (const w of ["w-cost", "w-speed"])
    applyExploreOp(live(m), m.nodes, {
      op: "cell",
      option: "pg",
      want: w,
      mark: "same",
      facts: ["f-pg"],
    });
  const g = nextGap(peek(m), m.nodes);
  assert.deepEqual([g.kind, g.q], ["open", "q2"]);
  assert.match(g.label, /^Open choice: Which host\?/);
  // the server, asked anyway, works on q2's own board, not the tree
  const before = turns.length;
  await run("next", {});
  assert.equal(turns.length, before + 1);
  assert.equal(turns.at(-1)!.opts.nodeId, "q2");
  assert.doesNotMatch(turns.at(-1)!.action, /clearer or decidable/);
});

test("a check's result reported in its thread is weighed, then settling is yours", async () => {
  const m = storedMap(parseDump(RUN2));
  const { run, turns } = stub(m);
  await run("commit", { option: "opt-resp-bofu" });
  await run("settle", { q: "root", answer: "Traffic fell" });
  await run("settle", { q: "q-confirm-serp", answer: "two checks" });
  const t0 = Date.now();
  const s = live(m);
  applyExploreOp(
    s,
    m.nodes,
    {
      op: "stand",
      q: "q-organic-cause",
      lead: null,
      line: "nothing checked yet",
    },
    { now: t0 },
  );
  applyExploreOp(
    s,
    m.nodes,
    {
      op: "takeaway",
      node: "fact-query-split",
      text: "Run first: brand CTR flat means AI overviews",
    },
    { now: t0 + 1 },
  );
  const ran = nextGap(peek(m), m.nodes);
  assert.equal(ran.kind, "run");
  // yours to run: the button says so, and names no check (cut short, the
  // name read as Claude running it)
  assert.equal(ran.short, "Run the check yourself");
  // you ran it; Claude's thread answer wrote the result into the card
  m.nodes["fact-query-split"] = {
    ...m.nodes["fact-query-split"],
    title: "Where CTR fell",
    summary: "Brand CTR flat; 'what is' queries down 60%",
    updatedAt: t0 + 1000,
  };
  let g = nextGap(peek(m), m.nodes);
  assert.deepEqual(
    [g.kind, g.q, g.option],
    ["question", "q-organic-cause", "fact-query-split"],
  );
  assert.match(g.label, /^Weigh what came in/);
  assert.equal(g.short, "Weigh the new result");
  await run("next", {});
  assert.match(turns.at(-1)!.action, /WEIGH what came in/);
  assert.match(turns.at(-1)!.action, /Write a stand op/);
  // and picks the check to run next, so Next does not sell that pick again
  assert.match(turns.at(-1)!.action, /takeaway op on it starting "Run first:"/);
  // Claude's stand leads the cause it points at; you mark it likely
  applyExploreOp(
    live(m),
    m.nodes,
    {
      op: "stand",
      q: "q-organic-cause",
      lead: "opt-org-serp",
      line: "the split points at AI overviews",
      sure: SETTLE_SURE + 10,
    },
    { now: t0 + 2000 },
  );
  await run("commit", { option: "opt-org-serp" });
  g = nextGap(peek(m), m.nodes);
  assert.deepEqual([g.kind, g.q], ["settle", "q-organic-cause"]);
  assert.ok(YOURS.has(g.kind));
  const before = turns.length;
  const r = await run("next", {});
  assert.ok("error" in r);
  assert.equal(turns.length, before);
});

test("a name past the limit is said to be too long, never cut as you type", () => {
  assert.ok(!tooLong("Runs locally in Docker"));
  assert.ok(tooLong("x".repeat(81)));
  assert.ok(!tooLong(`${"x".repeat(80)}   `));
});

// ---------------------------------------------------------------- the Tree

// A cause list as QA's AWS run had it: the question, five causes with three
// checks each, a fix sub-choice with four options under one cause.
function awsTree(): MapNode[] {
  const list = [node("root", null, "question", "What explains the AWS bill?")];
  for (let c = 0; c < 5; c++) {
    list.push(node(`c${c}`, "root", "option", `Cause ${c}`));
    for (let k = 0; k < 3; k++)
      list.push(node(`c${c}-k${k}`, `c${c}`, "fact", `Check ${c}.${k}`));
  }
  list.push(node("q-fix", "c1", "question", "How to cut cross-AZ traffic?"));
  for (let o = 0; o < 4; o++)
    list.push(node(`fix${o}`, "q-fix", "option", `Fix ${o}`));
  return list.map((n, i) => ({ ...n, order: i }));
}
const H = 100;

// the room at 1440×900, as Tree.tsx sizes rows: wide enough for a row at
// the readable zoom
const WIDE = 1392 / 0.7;
const overlapFree = (
  b: Record<string, { x: number; y: number; w: number; h: number }>,
) => {
  const all = Object.values(b);
  for (const a of all)
    for (const c of all)
      if (a !== c)
        assert.ok(
          a.x + a.w <= c.x ||
            c.x + c.w <= a.x ||
            a.y + a.h <= c.y ||
            c.y + c.h <= a.y,
        );
};

test("the Tree lays the causes across under the question, and each one's checks down its column", () => {
  const t = treeLayout(awsTree(), { maxW: WIDE, heightOf: () => H });
  const b = t.boxes;
  assert.equal(t.root, "root");
  assert.deepEqual(t.heads, ["c0", "c1", "c2", "c3", "c4"]);
  // one row, left to right, all below the question
  for (let c = 0; c < 5; c++) {
    assert.equal(b[`c${c}`].y, b.c0.y);
    assert.ok(b[`c${c}`].y > b.root.y + H);
    if (c) assert.ok(b[`c${c}`].x > b[`c${c - 1}`].x + 248);
  }
  // the question is centred over the row
  const rest = Object.entries(b).filter(([id]) => id !== "root");
  const mid =
    (Math.min(...rest.map(([, x]) => x.x)) +
      Math.max(...rest.map(([, x]) => x.x + x.w))) /
    2;
  assert.ok(Math.abs(b.root.x + 124 - mid) < 30);
  // checks stack under their cause, indented, in order
  assert.ok(b["c0-k0"].y > b.c0.y && b["c0-k1"].y > b["c0-k0"].y);
  assert.ok(b["c0-k0"].x > b.c0.x);
  // the question's lines run along a bus; a column's down its spine
  const row = t.edges.find((e) => e.target === "c2");
  assert.equal(row?.kind, "row");
  assert.equal(t.edges.find((e) => e.target === "c2-k0")?.kind, "column");
  overlapFree(b);
});

test("a sub-choice under a cause lays its options across, two to a row, not one tall column", () => {
  const list = awsTree();
  list.push(node("fix4", "q-fix", "option", "Fix 4", { order: 99 }));
  const t = treeLayout(list, { maxW: WIDE, heightOf: () => H });
  const b = t.boxes;
  // its options below it, side by side, then the next row
  assert.ok(b.fix0.y > b["q-fix"].y + H);
  assert.equal(b.fix1.y, b.fix0.y);
  assert.ok(b.fix1.x >= b.fix0.x + 248);
  assert.ok(b.fix2.y > b.fix0.y && b.fix2.x === b.fix0.x);
  assert.equal(t.edges.find((e) => e.target === "fix1")?.kind, "row");
  // the causes beside it stay on the first row, so fit can frame them
  assert.equal(b.c4.y, b.c0.y);
  overlapFree(b);
});

test("a check on the question itself stacks beside the causes, and stays put as a cause grows", () => {
  const list = awsTree().filter(
    (n) => !n.id.startsWith("fix") && n.id !== "q-fix",
  );
  list.push(
    node("k-root", "root", "fact", "To check: Cost Explorer by service", {
      order: 1,
    }),
    node("k-root2", "root", "fact", "To check: NAT bytes", { order: 2 }),
  );
  const before = treeLayout(list, { maxW: WIDE, heightOf: () => H });
  // first row, after the causes, one stacked under the other
  assert.equal(before.boxes["k-root"].y, before.boxes.c0.y);
  assert.ok(before.boxes["k-root"].x > before.boxes.c4.x);
  assert.equal(before.boxes["k-root2"].x, before.boxes["k-root"].x);
  assert.ok(before.boxes["k-root2"].y > before.boxes["k-root"].y);
  assert.equal(before.edges.find((e) => e.target === "k-root2")?.kind, "stack");
  assert.deepEqual(before.heads.slice(-2), ["k-root", "k-root2"]);
  // Go deeper on a cause: its column grows, two levels down, and nothing
  // else moves
  list.push(
    node("deep", "c0-k0", "fact", "Deeper", { order: 200 }),
    node("deeper", "deep", "fact", "Deeper still", { order: 201 }),
  );
  const after = treeLayout(list, { maxW: WIDE, heightOf: () => H });
  for (const id of ["root", "c1", "c4", "k-root", "k-root2", "c4-k2"])
    assert.deepEqual(after.boxes[id], before.boxes[id], id);
  overlapFree(after.boxes);
});

test("setting a cause aside moves no card", () => {
  const list = awsTree();
  const before = treeLayout(list, { maxW: WIDE, heightOf: () => H });
  list.find((n) => n.id === "c0")!.dropped = true;
  const after = treeLayout(list, { maxW: WIDE, heightOf: () => H });
  assert.deepEqual(after.boxes, before.boxes);
  assert.deepEqual(after.heads, ["c0", "c1", "c2", "c3", "c4"]);
});

test("past maxW the Tree wraps into another row, with a trunk to it", () => {
  const list = awsTree().filter(
    (n) => !n.id.startsWith("fix") && n.id !== "q-fix",
  );
  const t = treeLayout(list, { maxW: 960, heightOf: () => H });
  assert.equal(t.boxes.c3.y, t.boxes.c4.y);
  assert.equal(t.boxes.c2.y, t.boxes.c0.y);
  assert.ok(t.boxes.c3.y > t.boxes["c1-k2"].y, "below the first row's columns");
  const e = t.edges.find((x) => x.target === "c3");
  assert.ok(e?.trunk !== undefined && e.rowBus !== undefined);
  assert.equal(t.edges.find((x) => x.target === "c0")?.trunk, undefined);
});

test("a folded branch is one card, with how many are under it", () => {
  const t = treeLayout(awsTree(), {
    maxW: WIDE,
    heightOf: () => H,
    folds: (n) => n.id === "c1",
  });
  assert.equal(t.folded.c1, 3 + 1 + 4);
  assert.ok(!t.boxes["q-fix"] && !t.boxes.fix0 && !t.boxes["c1-k0"]);
  assert.ok(!t.edges.some((e) => e.source === "c1"));
});

test("Fit frames the tree whole when it reads whole, else the question and every cause from the top", () => {
  const room = { left: 24, top: 24, w: 1392, h: 676 };
  const tall = treeLayout(awsTree(), { maxW: WIDE, heightOf: () => H });
  const v = frameOf(tall, room);
  assert.ok(v.zoom >= 0.7 && v.zoom <= 1);
  const onScreen = (id: string) => {
    const b = tall.boxes[id];
    const x = b.x * v.zoom + v.x;
    const y = b.y * v.zoom + v.y;
    return (
      x >= room.left - 0.5 &&
      x + b.w * v.zoom <= room.left + room.w + 0.5 &&
      y >= room.top - 0.5 &&
      y + b.h * v.zoom <= room.top + room.h + 0.5
    );
  };
  for (const id of ["root", "c0", "c1", "c2", "c3", "c4"])
    assert.ok(onScreen(id), `${id} is on screen`);
  // the question sits at the top of the room, the columns run on below it
  assert.ok(Math.abs(tall.boxes.root.y * v.zoom + v.y - room.top) < 1);
  // a small tree is framed whole, centred
  const small = treeLayout(awsTree().slice(0, 4), {
    maxW: WIDE,
    heightOf: () => H,
  });
  const w = frameOf(small, room);
  assert.equal(w.zoom, 1);
});

test("a cause holding a sub-choice lays it narrower rather than wrap below the frame", () => {
  // QA round 6's support tickets: four causes, a stack of checks on the
  // question, and the likely cause with a five-option fix under it
  const list = awsTree().filter(
    (n) => !n.id.startsWith("fix") && n.id !== "q-fix",
  );
  list.push(
    node("k-root", "root", "fact", "To check: where the time goes", {
      order: 1,
    }),
    node("q-fix", "c4", "question", "How to cut the wait?", { order: 300 }),
  );
  for (let o = 0; o < 5; o++)
    list.push(
      node(`fix${o}`, "q-fix", "option", `Fix ${o}`, { order: 301 + o }),
    );
  const t = treeLayout(list, { maxW: WIDE, heightOf: () => H });
  for (const id of ["c0", "c4", "k-root"])
    assert.equal(t.boxes[id].y, t.boxes.c0.y, `${id} on the first row`);
  const right = Math.max(...Object.values(t.boxes).map((b) => b.x + b.w));
  const left = Math.min(...Object.values(t.boxes).map((b) => b.x));
  assert.ok(right - left <= WIDE + 1, "within the room at a readable zoom");
  assert.ok(t.boxes.fix1.y > t.boxes.fix0.y, "one to a row, as it fits");
  const v = frameOf(t, { left: 24, top: 24, w: 1392, h: 676 });
  assert.ok(v.zoom >= 0.7);
});

// ---------------------------------------------------------------- round 7

// A rent-or-buy board after a Fill: Claude can't tell Buy now's must without
// your budget, and says so citing a check still to run.
function budgetBoard() {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  nodes["k-budget"] = node(
    "k-budget",
    "q",
    "fact",
    "Your budget not yet known",
    {
      summary: "To check: income, savings, local prices decide affordability",
      updatedAt: 50,
      order: 40,
    },
  );
  for (const o of ["keep", "pg", "dyn"]) {
    applyExploreOp(
      s,
      nodes,
      {
        op: "cell",
        option: o,
        want: "w-speed",
        mark: "same",
        facts: ["f-pg"],
      },
      { now: 60 },
    );
    applyExploreOp(
      s,
      nodes,
      o === "pg"
        ? {
            op: "cell",
            option: o,
            want: "w-cost",
            mark: "unknown",
            note: "needs your income",
            facts: ["k-budget"],
            sure: "low",
          }
        : {
            op: "cell",
            option: o,
            want: "w-cost",
            mark: "same",
            facts: ["f-pg"],
          },
      { now: 60 },
    );
  }
  return { map, s, nodes };
}

test("Next never spends a move on a can't-tell that waits on a check only you can answer", () => {
  const { s, nodes } = budgetBoard();
  let g = nextGap(s, nodes, "q");
  assert.equal(g.kind, "tell");
  assert.ok(YOURS.has(g.kind), "pressing it pays for no move");
  assert.equal(g.want, "w-cost");
  assert.equal(g.label, 'Answer "Your budget not yet known" to settle 1 cell');
  // Claude adds an option with a fact of its own behind its cost cell: no
  // news on the budget, so still no paid ask on pg's cost
  nodes.hack = node("hack", "q", "option", "Buy and rent part out", {
    order: 45,
    updatedAt: 70,
  });
  nodes["f-hack"] = node("f-hack", "hack", "fact", "Tenant rent offsets", {
    updatedAt: 70,
    order: 46,
  });
  applyExploreOp(
    s,
    nodes,
    {
      op: "cell",
      option: "hack",
      want: "w-cost",
      mark: "better",
      facts: ["f-hack"],
    },
    { now: 71 },
  );
  g = nextGap(s, nodes, "q");
  assert.ok(
    !(g.kind === "ask" && g.option === "pg" && g.want === "w-cost"),
    `no ask on the cell that waits on you (got ${g.kind} ${g.option} ${g.want})`,
  );
  // what you say is what it waited for: Claude can judge it again
  nodes["f-mine"] = node("f-mine", "q", "fact", "Take-home $6,500", {
    by: "you",
    updatedAt: 80,
    order: 47,
  });
  g = nextGap(s, nodes, "q");
  assert.deepEqual([g.kind, g.option, g.want], ["ask", "pg", "w-cost"]);
});

test("a check is answered once the cells that waited on it are judged on a newer fact", () => {
  const { s, nodes } = budgetBoard();
  nodes["f-numbers"] = node("f-numbers", "pg", "fact", "Your numbers", {
    summary: "$6.5k take-home, $90k saved",
    updatedAt: 100,
    order: 48,
  });
  applyExploreOp(
    s,
    nodes,
    {
      op: "cell",
      option: "pg",
      want: "w-cost",
      mark: "fails",
      facts: ["f-numbers"],
    },
    { scope: "pg", now: 110 },
  );
  assert.equal(nodes["k-budget"].summary, "Found: $6.5k take-home, $90k saved");
  assert.ok(!isCheck(nodes["k-budget"]), "no longer a check to run");
  // a check another cell still cites stays open
  const b = budgetBoard();
  b.s.boards.q.cells["dyn|w-cost"].claude!.facts = ["k-budget"];
  b.nodes["f-numbers"] = nodes["f-numbers"];
  applyExploreOp(
    b.s,
    b.nodes,
    {
      op: "cell",
      option: "pg",
      want: "w-cost",
      mark: "fails",
      facts: ["f-numbers"],
    },
    { now: 110 },
  );
  assert.ok(isCheck(b.nodes["k-budget"]));
});

test("Fill stays on the board while a must cell is empty, however full the rest is", () => {
  const { s, nodes } = budgetBoard();
  assert.equal(viewOf(s, nodes, {}).boards.q.emptyMusts, 0);
  nodes.yb = node("yb", "q", "option", "YugabyteDB", { order: 50 });
  applyExploreOp(s, nodes, {
    op: "cell",
    option: "yb",
    want: "w-speed",
    mark: "same",
    facts: ["f-pg"],
  });
  const v = viewOf(s, nodes, {}).boards.q;
  assert.equal(v.needsFill, false, "most of the board has a mark");
  assert.equal(v.emptyMusts, 1, "yb's cost is empty: Fill stays");
});

test("a check's thread may write the stand of the question it sits under", () => {
  const nodes: Nodes = Object.fromEntries(
    [
      node("root", null, "question", "Why did AWS costs rise?"),
      node("c-nat", "root", "option", "NAT charges"),
      node("k-ce", "root", "fact", "Cost Explorer by service", {
        summary: "To check: usage types",
      }),
      node("k-flow", "c-nat", "fact", "Flow logs", {
        summary: "To check: top talkers",
      }),
    ].map((n, i) => [n.id, { ...n, order: i }]),
  );
  const map = { nodes, data: {} as Record<string, unknown> };
  const s = live(map);
  const stand = {
    op: "stand",
    q: "root",
    lead: "c-nat",
    line: "NAT",
    sure: 85,
  };
  assert.equal(applyExploreOp(s, nodes, stand, { scope: "k-ce" }), 1);
  assert.equal(applyExploreOp(s, nodes, stand, { scope: "k-flow" }), 1);
  assert.equal(s.stand.root.sure, 85);
  // never another question's
  nodes.q2 = node("q2", "c-nat", "question", "How to cut it?", { order: 9 });
  assert.equal(
    applyExploreOp(
      s,
      nodes,
      { ...stand, q: "q2", lead: null },
      { scope: "k-ce" },
    ),
    0,
  );
});

test("a cause list's outline speaks of causes, never of wants", () => {
  const nodes: Nodes = Object.fromEntries(
    [
      node("root", null, "question", "What could explain the AWS bill?"),
      node("c1", "root", "option", "NAT charges"),
    ].map((n, i) => [n.id, { ...n, order: i }]),
  );
  const s = live({ nodes, data: {} });
  assert.equal(s.boards.root.shape, "causes", "read from its words");
  const text = outlineOf(s, nodes);
  assert.doesNotMatch(text, /WANTS:/);
  assert.match(text, /CAUSES: \[c1\]/);
});

test("an option you added can be renamed; Claude's cannot", async () => {
  const m = storedMap(boardNodes());
  const { run } = stub(m);
  const added = await run("option", { q: "q", title: "CockroachDB" });
  const id = added.nodeId!;
  const r = await run("option", {
    q: "q",
    id,
    title: "CockroachDB Serverless",
  });
  assert.ok(r.ok);
  assert.equal(m.nodes[id].title, "CockroachDB Serverless");
  const no = await run("option", { q: "q", id: "pg", title: "Postgres 17" });
  assert.ok(no.error);
  assert.equal(m.nodes.pg.title, "Postgres");
});

test("a column counts the messages in its threads, as its panel does", () => {
  const { s, nodes } = budgetBoard();
  const threads = {
    t1: { nodeId: "pg", messages: [1, 2, 3] },
    t2: { nodeId: "pg", messages: [1] },
  };
  const col = viewOf(s, nodes, threads).boards.q.columns.find(
    (c) => c.id === "pg",
  );
  assert.equal(col?.threads, 4);
});

// ---------------------------------------------------------------- round 8

// An auth choice after a Fill: Claude can't tell keep-as-is and DynamoDB on
// the cost must, checked in their threads; Postgres, its lead, is a guess.
function toldBoard() {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  const cell = (option: string, want: string, o: Raw, scope?: string) =>
    applyExploreOp(
      s,
      nodes,
      { op: "cell", option, want, ...o },
      { now: 60, ...(scope ? { scope } : {}) },
    );
  for (const o of ["keep", "pg", "dyn"])
    cell(o, "w-speed", { mark: "same", facts: ["f-pg"] });
  cell("keep", "w-cost", { mark: "unknown", facts: ["f-pg"] }, "keep");
  cell("dyn", "w-cost", { mark: "unknown", facts: ["f-pg"] }, "dyn");
  cell("pg", "w-cost", { mark: "same" });
  applyExploreOp(s, nodes, { op: "stand", q: "q", lead: "pg", line: "x" });
  return { map, s, nodes };
}

test("once you told a want's thread what you know, Next moves on from 'Say what you know'", () => {
  const { s, nodes } = toldBoard();
  // with Claude leading, what only you know does not hold the choice back:
  // the lead's case against is next, and the must stays open in the sheet
  assert.equal(nextGap(s, nodes, "q").kind, "against");
  assert.ok(viewOf(s, nodes, {}).open.some((o) => o.kind === "guess-must"));
  // before Claude leads, it comes first
  const lead = s.stand.q.lead;
  s.stand.q.lead = null;
  let g = nextGap(s, nodes, "q");
  assert.equal(g.kind, "tell");
  assert.equal(g.label, "Say what you know: w-cost");
  // you tell the want's thread; Claude files it under the want and judges
  // the row on it, and still can't tell DynamoDB
  nodes["f-mine"] = node("f-mine", "w-cost", "fact", "Current login", {
    updatedAt: 70,
    order: 60,
  });
  applyExploreOp(
    s,
    nodes,
    {
      op: "cell",
      option: "dyn",
      want: "w-cost",
      mark: "unknown",
      facts: ["f-mine"],
    },
    { scope: "w-cost", now: 70 },
  );
  assert.equal(s.boards.q.rows[0].told, 70);
  g = nextGap(s, nodes, "q");
  assert.deepEqual(
    [g.kind, g.option, g.want, g.reason],
    ["ask", "pg", "w-cost", "a must, only a guess"],
    "the lead's guess, which a move can settle",
  );
  // the Ask on it ends "can't tell" too: Next still does not send you back
  applyExploreOp(
    s,
    nodes,
    {
      op: "cell",
      option: "pg",
      want: "w-cost",
      mark: "unknown",
      facts: ["f-pg"],
    },
    { scope: "pg", now: 80 },
  );
  s.stand.q.lead = lead;
  g = nextGap(s, nodes, "q");
  assert.notEqual(g.kind, "tell");
  assert.equal(g.kind, "against");
});

test("a want's thread may write another want's cell only when it cites a fact filed under the want", () => {
  const { s, nodes } = toldBoard();
  nodes["f-mine"] = node("f-mine", "w-cost", "fact", "Current login", {
    order: 60,
  });
  const other = { op: "cell", option: "keep", want: "w-speed", mark: "worse" };
  assert.equal(applyExploreOp(s, nodes, other, { scope: "w-cost" }), 0);
  assert.equal(
    applyExploreOp(
      s,
      nodes,
      { ...other, facts: ["f-mine"] },
      { scope: "w-cost" },
    ),
    1,
  );
  assert.equal(s.boards.q.cells["keep|w-speed"].claude?.mark, "worse");
  // only the thread's own row counts as told
  assert.equal(s.boards.q.rows[1].told, undefined);
});

test("Claude leads only an option it has judged itself on every must", () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  // your rating is yours, not Claude's evidence
  s.boards.q.cells["pg|w-cost"] = {
    you: { mark: "better", note: "", facts: [], sure: "high", at: 1 },
  };
  applyExploreOp(s, nodes, {
    op: "stand",
    q: "q",
    lead: "pg",
    line: "Only option rated on cost",
    sure: 45,
  });
  assert.equal(s.stand.q.lead, null);
  assert.equal(s.stand.q.sure, undefined);
  assert.equal(s.stand.q.line, "Only option rated on cost");
  applyExploreOp(s, nodes, {
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "same",
    facts: ["f-pg"],
  });
  applyExploreOp(s, nodes, {
    op: "stand",
    q: "q",
    lead: "pg",
    line: "Fits",
    sure: 60,
  });
  assert.deepEqual([s.stand.q.lead, s.stand.q.sure], ["pg", 60]);
});

test("a must on your choice that turned 'can't tell' stays open", () => {
  const { s, nodes } = toldBoard();
  nodes.pg.status = "chosen";
  nodes.keep.status = "dropped";
  nodes.dyn.status = "dropped";
  s.boards.q.commit = {
    option: "pg",
    why: "",
    at: 90,
    premortem: { claude: [] },
  };
  const unsure = () =>
    openItems(s, nodes).find((o) => o.kind === "chosen-unsure")?.label;
  assert.equal(unsure(), "1 must unsure on your choice", "a guess");
  applyExploreOp(
    s,
    nodes,
    {
      op: "cell",
      option: "pg",
      want: "w-cost",
      mark: "unknown",
      note: "Meets only once MFA is on",
      facts: ["f-pg"],
    },
    { scope: "pg", now: 100 },
  );
  assert.equal(unsure(), "1 must unsure on your choice", "now can't tell");
});

test("Next on a must that waits on a check names the check it opens", () => {
  const { s, nodes } = budgetBoard();
  const g = nextGap(s, nodes, "q");
  assert.equal(g.kind, "tell");
  assert.equal(g.check, "k-budget");
});

// a cause list whose deciding check Claude picked, then you ran
function checkedCauses() {
  const nodes: Nodes = Object.fromEntries(
    [
      node("root", null, "question", "Why do tickets take twice as long?"),
      node("c-proc", "root", "option", "Process or tool change"),
      node("c-meas", "root", "option", "Measurement changed"),
      node("k-split", "root", "fact", "Split time by stage", {
        summary: "Where the time goes",
        updatedAt: 10,
      }),
      node("k-review", "root", "fact", "Time in pending review", {
        summary: "To check: hours per ticket in pending internal review",
        updatedAt: 10,
      }),
      node("f-other", "root", "fact", "Volume is flat", { updatedAt: 10 }),
    ].map((n, i) => [n.id, { ...n, order: i }]),
  );
  const map = { nodes, data: {} as Record<string, unknown> };
  const s = live(map);
  applyExploreOp(
    s,
    nodes,
    { op: "takeaway", node: "k-split", text: "Run first: splits the causes" },
    { now: 20 },
  );
  return { map, s, nodes };
}

test("a check whose result is written in is a fact: no RUN FIRST, and Next moves on", () => {
  const { s, nodes } = checkedCauses();
  assert.ok(isCheck(nodes["k-split"]), "an instruction for a title");
  assert.equal(nextGap(s, nodes).kind, "run");
  // you report the result in its thread; Claude writes it in
  nodes["k-split"].summary = "Found: the gap between touches tripled";
  nodes["k-split"].updatedAt = 30;
  applyExploreOp(
    s,
    nodes,
    { op: "stand", q: "root", lead: "c-proc", line: "Waiting", sure: 85 },
    { scope: "k-split", now: 31 },
  );
  assert.ok(!isCheck(nodes["k-split"]));
  const v = viewOf(s, nodes, {});
  assert.equal(v.questions.find((p) => p.id === "root")?.runFirst, undefined);
  const g = nextGap(s, nodes);
  assert.notEqual(g.kind, "run");
  // Claude leads a cause at 85% and you marked none likely: marking it is
  // yours, and free (QA round 9: Next sold another paid pick of a check)
  assert.deepEqual([g.kind, g.option], ["likely", "c-proc"]);
  assert.ok(YOURS.has(g.kind));
  // less sure, Claude picks the check that best splits the causes
  s.stand.root.sure = SETTLE_SURE - 1;
  assert.match(nextGap(s, nodes).reason, /^1 check on the map/);
  s.stand.root.sure = 85;
  // the thread names the next check to run: it may pick it there
  assert.equal(
    applyExploreOp(
      s,
      nodes,
      { op: "takeaway", node: "k-review", text: "Run first: is it review?" },
      { scope: "k-split", now: 32 },
    ),
    1,
  );
  assert.deepEqual(
    [nextGap(s, nodes).kind, nextGap(s, nodes).option],
    ["run", "k-review"],
  );
  // never a fact that is no check
  assert.equal(
    applyExploreOp(
      s,
      nodes,
      { op: "takeaway", node: "f-other", text: "x" },
      { scope: "k-split" },
    ),
    0,
  );
});

test("a sub-choice under a middle cause is laid narrower, so the causes after it stay on the first row", () => {
  // QA round 8: the fix sub-choice grew under 'Process or tool change', and
  // 'Measurement changed', after it, wrapped below the frame
  const list = awsTree();
  list.push(
    node("k-root", "root", "fact", "To check: where the time goes", {
      order: 1,
    }),
    // a check on the sub-choice itself, which took a column beside its
    // options however narrow it was laid
    node("k-fix", "q-fix", "fact", "To check: why review exists", {
      order: 400,
    }),
  );
  const t = treeLayout(list, { maxW: WIDE, heightOf: () => H });
  for (const id of ["c0", "c1", "c2", "c3", "c4", "k-root"])
    assert.equal(t.boxes[id].y, t.boxes.c0.y, `${id} on the first row`);
  // the sub-choice's check sits under its options, its line down the left
  assert.ok(t.boxes["k-fix"].y > t.boxes.fix3.y);
  const e = t.edges.find((x) => x.target === "k-fix");
  assert.equal(e?.kind, "stack");
  assert.ok(e!.spine! < t.boxes["q-fix"].x);
  const right = Math.max(...Object.values(t.boxes).map((b) => b.x + b.w));
  const left = Math.min(...Object.values(t.boxes).map((b) => b.x));
  assert.ok(right - left <= WIDE + 1, "within the room at a readable zoom");
  overlapFree(t.boxes);
});

// ---------------------------------------------------------------- round 9

test("a check's thread rewrites every cell that cites it, and the case against the option it is under", () => {
  const { map, s } = withWants(boardNodes());
  const n = map.nodes;
  // a check filed under Postgres, whose result you tell in its thread
  n["k-start"] = node("k-start", "pg", "fact", "Start date", {
    summary: "Found: Postgres team starts week 12",
    order: 50,
  });
  const op = (o: Raw) => applyExploreOp(s, n, o, { scope: "k-start" });
  const cell = (option: string, facts: string[]) => ({
    op: "cell",
    option,
    want: "w-cost",
    mark: "worse",
    facts,
  });
  // QA round 9: 4 of Claude's changes, the cell citing the check among them,
  // were refused while the stand line moved
  assert.equal(op(cell("pg", ["k-start"])), 1);
  assert.equal(op(cell("dyn", ["k-start"])), 1);
  assert.equal(s.boards.q.cells["dyn|w-cost"].claude?.mark, "worse");
  // a cell that does not cite it, or one on another board, is not its
  assert.equal(op(cell("keep", ["f-pg"])), 0);
  assert.equal(op({ ...cell("h1", ["k-start"]) }), 0);
  assert.equal(op({ op: "against", option: "pg", text: "Too slow" }), 1);
  assert.equal(op({ op: "against", option: "dyn", text: "No" }), 0);
  assert.equal(op({ op: "stand", q: "q", lead: null, line: "x" }), 1);
  assert.equal(
    op({ op: "want", q: "q", id: "w-x", title: "x", weight: "nice" }),
    0,
  );
});

test("Next asks you for what only you know before paying to check another guess", () => {
  const { map, s } = withWants(boardNodes());
  const nodes = map.nodes;
  // a Fill: every must a guess, speed judged
  for (const o of ["keep", "pg", "dyn"]) {
    applyExploreOp(
      s,
      nodes,
      { op: "cell", option: o, want: "w-cost", mark: "same", sure: "low" },
      { now: 10 },
    );
    applyExploreOp(
      s,
      nodes,
      { op: "cell", option: o, want: "w-speed", mark: "same", facts: ["f-pg"] },
      { now: 10 },
    );
  }
  let g = nextGap(s, nodes, "q");
  assert.deepEqual([g.kind, g.want], ["ask", "w-cost"]);
  // checked in its thread, it comes back the same guess: what decides it
  // is yours ("I don't know how much spare time the team has")
  applyExploreOp(
    s,
    nodes,
    {
      op: "cell",
      option: g.option,
      want: "w-cost",
      mark: "same",
      note: "depends on the team's spare time",
      sure: "low",
    },
    { scope: g.option!, now: 20 },
  );
  assert.deepEqual(
    waitsOnYou(nodes, s.boards.q, "must").map((w) => w.want),
    ["w-cost"],
  );
  g = nextGap(s, nodes, "q");
  assert.equal(g.kind, "tell");
  assert.match(g.label, /^Say what you know: w-cost$/);
  assert.match(g.reason, /^a must Claude can only guess at without you/);
  assert.match(g.reason, /spare time/);
  // an empty must on a want that does not wait on you still comes first
  applyExploreOp(s, nodes, {
    op: "want",
    q: "q",
    id: "w-legal",
    title: "Legal",
    weight: "must",
  });
  s.boards.q.rows.find((r) => r.id === "w-legal")!.suggested = false;
  g = nextGap(s, nodes, "q");
  assert.deepEqual(
    [g.kind, g.want, g.reason],
    ["ask", "w-legal", "a must, still empty"],
  );
});

test("Claude's pick of a check survives a Go deeper that only adds causes and checks", () => {
  const { s, nodes } = checkedCauses();
  assert.equal(nextGap(s, nodes).kind, "run");
  // Go deeper on a cause: two causes and a check under it, no finding
  nodes["c-sub"] = node("c-sub", "c-proc", "option", "New ticket form", {
    updatedAt: 30,
    order: 10,
  });
  nodes["k-sub"] = node("k-sub", "c-sub", "fact", "Form fields", {
    summary: "To check: fields added since the switch",
    updatedAt: 30,
    order: 11,
  });
  nodes["c-proc"].updatedAt = 30;
  let g = nextGap(s, nodes);
  assert.deepEqual([g.kind, g.option], ["run", "k-split"]);
  // a finding newer than the pick: the question is Claude's to weigh again
  nodes["f-new"] = node("f-new", "c-proc", "fact", "Form added 4 fields", {
    updatedAt: 40,
    order: 12,
  });
  g = nextGap(s, nodes);
  assert.notEqual(g.kind, "run");
});

test("a stand line cut to its words ends on a full sentence, or says it was cut", () => {
  const line =
    "Safari tracking prevention blocks the new provider's 3DS iframe in 14 of 20 replays. That fits the abandonment jump after the switch.";
  assert.equal(
    clipLine(line, 20, 160),
    "Safari tracking prevention blocks the new provider's 3DS iframe in 14 of 20 replays.",
  );
  assert.equal(
    clipLine("one two three four five six", 4, 160),
    "one two three four…",
  );
  assert.equal(clipLine("Short and whole.", 20, 160), "Short and whole.");
});
