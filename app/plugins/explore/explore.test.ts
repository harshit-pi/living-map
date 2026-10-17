// Explore's decision board, pure logic and actions with no model: cleaning the
// model's board ops, bringing older maps onto boards, the roll-up, Next,
// folding and tallies, what the model reads, and the moves you make.

import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyExploreOp,
  clip,
  newState,
  fold,
  live,
  nextGap,
  openItems,
  outlineOf,
  peek,
  reconcile,
  rollup,
  shown,
  tally,
  viewOf,
} from "./core.ts";
import { parseDump, RUN1, RUN2 } from "./fixtures.ts";
import { explore } from "./server.ts";
import {
  isCheck,
  type ExploreState,
  type ExploreView,
  type RowView,
} from "./shared.ts";
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
function stub(map: StoredMap, { busy = false } = {}) {
  const turns: { action: string; opts: TurnOptions }[] = [];
  let pushes = 0;
  const engine = {
    state: { map, busy: false, working: null, waiting: [] },
    push: () => pushes++,
    turn: async (action: string, _s: unknown, opts: TurnOptions = {}) => {
      turns.push({ action, opts });
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
  assert.equal(op(cell("dyn", "w-cost"), "pg"), 0);
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

  // 1: wants but no cells
  op({ op: "want", q: "q", id: "w-cost", title: "Cost", weight: "must" });
  assert.equal(gap().kind, "fill");
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
  // 2: no keep-as-is in the running
  nodes.keep.dropped = true;
  assert.equal(gap().kind, "something");
  delete nodes.keep.dropped;
  // 3: an empty must, the lead's column first
  op({ op: "stand", q: "q", lead: "dyn", line: "x" });
  let g = gap();
  assert.equal(g.kind, "ask");
  assert.equal(g.option, "dyn");
  assert.equal(g.want, "w-cost");
  assert.equal(g.reason, "a must, still empty");
  op({
    op: "cell",
    option: "dyn",
    want: "w-cost",
    mark: "better",
    facts: ["f-pg"],
  });
  op({ op: "cell", option: "pg", want: "w-cost", mark: "better" });
  g = gap();
  assert.equal(g.option, "pg");
  assert.equal(g.reason, "a must, only a guess");
  op({
    op: "cell",
    option: "pg",
    want: "w-cost",
    mark: "better",
    facts: ["f-pg"],
  });
  // 4: the lead has no case against
  g = gap();
  assert.equal(g.kind, "against");
  assert.equal(g.option, "dyn");
  op({ op: "against", option: "dyn", text: "lock-in" });
  // 5: an empty cell on a matters row
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
  // 6: a choice with no pre-mortem
  nodes.pg.status = "chosen";
  nodes.keep.status = "dropped";
  nodes.dyn.status = "dropped";
  g = gap();
  assert.equal(g.kind, "wrap");
  live(map).boards.q.commit!.premortem.claude = ["a"];
  // 7: an open choice elsewhere
  g = gap();
  assert.deepEqual([g.kind, g.q], ["question", "q2"]);
  assert.match(g.label, /^Open choice: Which host\?/);
  // 8: an open question
  nodes.h1.status = "chosen";
  nodes.h2.status = "dropped";
  nodes.q3 = node("q3", "q", "question", "Who runs backups?", { order: 40 });
  g = gap();
  assert.deepEqual([g.kind, g.q], ["question", "q3"]);
  assert.match(g.label, /^Open question/);
  // 9: nothing open
  nodes.q3.status = "answered";
  assert.equal(gap().kind, "sum");
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
  assert.equal(g.kind, "question");
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
  assert.match(turns.at(-1)!.action, /CAUSES of \[q-organic-cause\]/);
  assert.match(turns.at(-1)!.opts.label ?? "", /^Next: Tell the causes apart/);
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
    /Fill every one of these wants: \[w-cost\] must, \[w-speed\] matters, \[w-sugg\] nice\./,
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
  // a fact newer than the mark is something to check it against
  nodes["f-budget"] = node("f-budget", "dyn", "fact", "Budget $1,500/mo", {
    updatedAt: 300,
    order: 60,
  });
  g = nextGap(s, nodes, "q");
  assert.deepEqual([g.kind, g.option, g.want], ["ask", "pg", "w-cost"]);
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
