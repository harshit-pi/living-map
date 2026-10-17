import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";

import { applyOps, choose, outline, pathTo } from "./canvas.ts";
import {
  accepts,
  cleanSpec,
  cleanSpecWithAnswers,
  diagramOutline,
  normAnswer,
} from "./diagram.ts";
import { systemPrompt } from "./prompts.ts";
import { completeOps, unreadableOps, visiblePart } from "./reply.ts";
import {
  cleanScene,
  newPlay,
  playMove,
  sceneOutline,
  sceneView,
  showMove,
} from "./scene.ts";
import { splitStart } from "./start.ts";
import type { Canvas, SceneData } from "./types.ts";
import type { ArrayState, BoardState, Diagram } from "../../shared/model.ts";

type Of<F extends Diagram["form"]> = Extract<Diagram, { form: F }>;
// narrow a cleaned diagram to the form a test expects, failing loudly if it is not
const as = <F extends Diagram["form"]>(d: Diagram | null, form: F): Of<F> => {
  assert.equal(d?.form, form);
  return d as Of<F>;
};
const scene = (sc: SceneData | null | undefined): SceneData => {
  assert.ok(sc);
  return sc;
};

const FULL =
  'Added two options.\n```map\n{"ops":[\n{"op":"add","id":"q","parent":null,"kind":"question","title":"Which DB?","summary":"Pick one","status":"open"},\n{"op":"add","id":"pg","parent":"q","kind":"option","title":"Postgres","summary":"Relational, {braces} in \\"quotes\\"","status":"proposed"}\n]}\n```';
const fresh = (): Canvas => ({ nodes: {}, diagram: null, fills: {} });

test("streaming: only complete ops are returned, at every cut point", () => {
  let last = 0;
  for (let i = 0; i <= FULL.length; i++) {
    const ops = completeOps(FULL.slice(0, i));
    assert.ok(ops.length >= last);
    for (const op of ops) assert.ok(op.id);
    last = ops.length;
  }
  assert.equal(last, 2);
  assert.equal(
    completeOps(FULL)[1].summary,
    'Relational, {braces} in "quotes"',
  );
  assert.equal(visiblePart(FULL).trim(), "Added two options.");
});

test("a map block without the ops wrapper is still read", () => {
  const bare =
    'Caption.\n\n```map\n{"op":"diagram","spec":{"lanes":["a","b"]}}\n{"op":"add","id":"x"}\n```';
  assert.deepEqual(
    completeOps(bare).map((o) => o.op),
    ["diagram", "add"],
  );
  const arr = 'Caption.\n```map\n[{"op":"add","id":"x"}]\n```';
  assert.equal(completeOps(arr).length, 1);
});

test("ops build the tree; details stay lazy; Claude cannot choose", () => {
  const m = fresh();
  applyOps(m, completeOps(FULL));
  applyOps(m, [
    { op: "add", id: "x", parent: "nope", kind: "fact", title: "Stray" },
    { op: "update", id: "pg", status: "chosen" },
  ]);
  assert.equal(m.nodes.x.parent, "q");
  assert.equal(m.nodes.pg.detail, "");
  assert.equal(m.nodes.pg.status, "proposed");
  choose(m.nodes, "pg");
  assert.equal(m.nodes.pg.status, "chosen");
  assert.equal(m.nodes.q.status, "answered");
});

test("a thread only changes its own node and what is under it", () => {
  const m = fresh();
  applyOps(m, completeOps(FULL));
  applyOps(m, [
    { op: "add", id: "my", parent: "q", kind: "option", title: "MySQL" },
  ]);
  // thread pinned to pg: may update pg, may add under pg, may not touch q or my
  applyOps(
    m,
    [
      { op: "update", id: "pg", summary: "changed" },
      { op: "update", id: "my", summary: "should not change" },
      { op: "add", id: "ext", parent: "q", kind: "fact", title: "Extensions" },
      { op: "remove", id: "my" },
    ],
    { scope: "pg" },
  );
  assert.equal(m.nodes.pg.summary, "changed");
  assert.notEqual(m.nodes.my.summary, "should not change");
  assert.equal(
    m.nodes.ext.parent,
    "pg",
    "additions land under the thread node",
  );
  assert.ok(m.nodes.my, "cannot remove outside its node");
  assert.deepEqual(
    pathTo(m.nodes, "ext").map((n) => n.id),
    ["q", "pg", "ext"],
  );
});

test("a blank never carries its answer to the browser", () => {
  const spec = cleanSpec({
    form: "sequence",
    title: "TCP",
    lanes: ["Client", "Server"],
    steps: [
      { id: "s1", from: "Client", to: "Server", label: "SYN" },
      {
        id: "b1",
        from: "Server",
        to: "Client",
        label: "SYN-ACK",
        blank: true,
        prompt: "What comes back?",
      },
    ],
  });
  assert.equal(as(spec, "sequence").steps[1].label, "", "answer stripped");
  assert.equal(as(spec, "sequence").steps[1].blank, true);
  assert.equal(cleanSpec({ form: "pie" }), null, "unknown forms are refused");
});

test("judging right fills the blank; wrong leaves it blank", () => {
  const m = fresh();
  applyOps(m, [
    {
      op: "diagram",
      spec: {
        form: "grid",
        title: "DBs",
        columns: ["SQL", "NoSQL"],
        rows: [
          {
            label: "Schema",
            cells: [
              { id: "c1", text: "Fixed" },
              { id: "c2", blank: true, prompt: "NoSQL schema?" },
            ],
          },
        ],
      },
    },
  ]);
  m.fills.c2 = { text: "rigid", state: "pending" };
  applyOps(m, [{ op: "judge", id: "c2", state: "wrong" }]);
  assert.equal(m.fills.c2.state, "wrong");
  assert.equal(as(m.diagram, "grid").rows[0].cells[1].blank, true);
  applyOps(m, [{ op: "judge", id: "c2", state: "right", label: "Flexible" }]);
  assert.equal(as(m.diagram, "grid").rows[0].cells[1].text, "Flexible");
  assert.equal(as(m.diagram, "grid").rows[0].cells[1].blank, false);
  assert.match(diagramOutline(m.diagram, m.fills), /Schema: Fixed \| Flexible/);
  // Claude redraws the grid and sends the solved cell as a blank again: it stays solved
  applyOps(m, [
    {
      op: "diagram",
      spec: {
        form: "grid",
        title: "DBs",
        columns: ["SQL", "NoSQL"],
        rows: [
          {
            label: "Schema",
            cells: [
              { id: "c1", text: "Fixed" },
              { id: "c2", blank: true, prompt: "?" },
            ],
          },
        ],
      },
    },
  ]);
  assert.equal(as(m.diagram, "grid").rows[0].cells[1].text, "Flexible");
  assert.equal(as(m.diagram, "grid").rows[0].cells[1].filled, true);
});

test("every diagram form survives cleaning", () => {
  const forms = [
    {
      form: "concept",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", blank: true, prompt: "?" },
      ],
      links: [{ from: "a", to: "b", label: "causes" }],
    },
    { form: "timeline", events: [{ id: "e1", when: "1914", label: "War" }] },
    {
      form: "structure",
      boxes: [{ id: "m", label: "Map", rows: ["k → n"] }],
      arrows: [{ from: "m", to: "n", label: "to" }],
    },
  ];
  for (const f of forms) assert.ok(cleanSpec(f), f.form);
});

test("outline and prompts", () => {
  const m = fresh();
  applyOps(m, completeOps(FULL));
  assert.match(outline(m.nodes), /- \[q\] question · open/);
  const learn = systemPrompt("learn", ["diagram", "scene"]);
  assert.match(learn, /TOPIC DIAGRAM/);
  assert.match(learn, /PLAYABLE SCENE/);
  const lean = systemPrompt("learn");
  assert.doesNotMatch(
    lean,
    /TOPIC DIAGRAM \(learning maps only\)|PLAYABLE SCENE|EXPLAIN on a node|THREADS:/,
  );
  assert.ok(
    lean.length < learn.length / 2,
    "a move that needs no extras sends far less",
  );
  assert.match(systemPrompt("explore"), /EXPLORATION CANVAS/);
  assert.doesNotMatch(systemPrompt("explore"), /TOPIC DIAGRAM/);
});

test("a pasted problem page keeps its full text; the title drops the page chrome", () => {
  const page =
    "49. Group Anagrams\nSolved\nMedium\nTopics\npremium lock icon\nCompanies\nGiven an array of strings strs, group the anagrams together. You can return the answer in any order.\nExample 1:";
  const { title, source } = splitStart(page);
  assert.equal(title, "49. Group Anagrams");
  assert.match(source, /in any order\.\nExample 1:/);
  assert.doesNotMatch(source, /premium lock icon|Solved/);
  assert.deepEqual(splitStart("Why did WW1 start?"), {
    title: "Why did WW1 start?",
    source: "",
  });
});

test("a sequence step naming a party outside the lanes gets its own lane", () => {
  const spec = cleanSpec({
    form: "sequence",
    lanes: ["Virus", "Cell"],
    steps: [
      { id: "s1", from: "Virus", to: "Cell", label: "enters" },
      { id: "s2", from: "T cell", to: "cell", label: "kills" },
    ],
  });
  assert.deepEqual(as(spec, "sequence").lanes, ["Virus", "Cell", "T cell"]);
});

test("a scene is played move by move; answers never reach the browser", () => {
  const sc = scene(
    cleanScene({
      kind: "board",
      title: "4 queens",
      start: {
        cells: [
          ["", "", "", ""],
          ["", "", "", ""],
        ],
      },
      moves: [
        {
          ask: "Place the row-0 queen",
          answer: {
            cells: [
              [0, 1],
              [0, 2],
            ],
          },
          then: {
            cells: [
              ["", "Q", "", ""],
              ["", "", "", ""],
            ],
            marks: [{ at: [1, 0], tone: "attack" }],
          },
          why: "Leftmost safe start that works",
          wrong: { "0,0": "That one dead-ends later" },
        },
        {
          ask: "Stuck?",
          choices: ["Place here", "Backtrack"],
          answer: { choice: "Backtrack" },
          then: {
            cells: [
              ["", "", "", ""],
              ["", "", "", ""],
            ],
          },
          why: "No safe square left",
        },
      ],
    }),
  );
  let p = newPlay();
  const before = JSON.stringify(sceneView(sc, p));
  assert.doesNotMatch(before, /0,1|Backtrack"|keys/, "no answers in the view");
  p = playMove(sc, p, "0,0");
  assert.equal(p.last?.ok, false);
  assert.equal(p.last?.text, "That one dead-ends later");
  p = playMove(sc, p, "0, 2");
  assert.equal(p.at, 1);
  assert.equal((sceneView(sc, p).state as BoardState).cells[0][1], "Q");
  assert.match(sceneOutline(sc, p), /backtrack/);
  p = showMove(sc, p);
  assert.equal(sceneView(sc, p).done, true);
  assert.equal(p.shown, 1);
  assert.equal(cleanScene({ kind: "pie", moves: [] }), null);
});

test("a scene streamed move by move is playable before it is complete", () => {
  const m: Canvas = {
    nodes: {
      s: {
        id: "s",
        parent: null,
        kind: "question",
        title: "S",
        summary: "",
        detail: "",
        status: "open",
        by: "claude",
        updatedAt: 0,
        order: 0,
      },
    },
    diagram: null,
    fills: {},
  };
  applyOps(m, [
    {
      op: "scene",
      step: "s",
      spec: {
        kind: "array",
        title: "Find 7",
        start: { items: ["2", "7", "11"], pointers: [{ name: "lo", at: 0 }] },
      },
    },
  ]);
  applyOps(m, [
    {
      op: "move",
      step: "s",
      ask: "Where is 7?",
      answer: { index: 1 },
      why: "Yes",
    },
  ]);
  const sc = scene(m.scenes?.s);
  const play = () => m.play?.s;
  let v = sceneView(sc, play());
  assert.equal(v.done, false);
  assert.equal(v.ask, "Where is 7?");
  assert.deepEqual(
    (sc.moves[0].then as ArrayState).items,
    ["2", "7", "11"],
    'a move without "then" keeps the picture',
  );
  m.play = { s: { ...newPlay(), ...play(), at: 1 } };
  v = sceneView(sc, play());
  assert.equal(
    v.waiting,
    true,
    "past the last written move, it waits instead of finishing",
  );
  sc.complete = true;
  assert.equal(sceneView(sc, play()).done, true);
});

test("a reply whose explanation holds a fenced code example is read whole", () => {
  // a real Show-answer reply: the detail contains ``` inside a JSON string
  const reply = fs.readFileSync(
    new URL("./fixtures-answer-with-code.txt", import.meta.url),
    "utf8",
  );
  const ops = completeOps(reply);
  assert.equal(ops.length, 3);
  assert.match(ops[0].detail, /compile error: a was moved/);
  assert.equal(ops[2].label, "None: freed when the owner's scope ends");
  assert.equal(unreadableOps(reply), 0);
});

test("raw line breaks inside a string do not lose the op", () => {
  const reply =
    'Ok.\n```map\n{"ops":[\n{"op":"update","id":"x","detail":"line one\nline two"},\n{"op":"remove","id":"y"}\n]}\n```';
  const ops = completeOps(reply);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].detail, "line one\nline two");
});

const node = (id: string, parent: string | null) => ({
  id,
  parent,
  kind: "question" as const,
  title: id,
  summary: "",
  detail: "",
  status: "open" as const,
  by: "claude" as const,
  updatedAt: 0,
  order: 0,
});

test("ids that name built-in object properties are refused and pollute nothing", () => {
  const m: Canvas = { nodes: { r: node("r", null) }, diagram: null, fills: {} };
  applyOps(m, [
    {
      op: "add",
      id: "constructor",
      parent: "r",
      kind: "question",
      title: "C",
      status: "open",
    },
    { op: "add", id: "__proto__", parent: "r", title: "P" },
    { op: "update", id: "toString", title: "T" },
  ]);
  assert.deepEqual(Object.keys(m.nodes), ["r"]);
  assert.equal(
    ({} as Record<string, unknown>).title,
    undefined,
    "Object.prototype untouched",
  );
});

test("the root is never removed", () => {
  const m: Canvas = {
    nodes: { r: node("r", null), a: node("a", "r") },
    diagram: null,
    fills: {},
  };
  applyOps(m, [{ op: "remove", id: "r" }]);
  assert.ok(m.nodes.r);
  applyOps(m, [{ op: "remove", id: "a" }]);
  assert.equal(m.nodes.a, undefined, "other nodes still can be");
});

test("a side thread changes only its node's subtree, and nothing once its node is gone", () => {
  const m: Canvas = {
    nodes: { r: node("r", null), a: node("a", "r"), b: node("b", "r") },
    diagram: null,
    fills: {},
  };
  applyOps(
    m,
    [
      { op: "remove", id: "r" },
      { op: "update", id: "b", title: "x" },
    ],
    { scope: "gone" },
  );
  assert.ok(m.nodes.r);
  assert.equal(m.nodes.b.title, "b");
  applyOps(
    m,
    [
      {
        op: "diagram",
        spec: {
          form: "timeline",
          title: "T",
          events: [{ id: "e", when: "1", label: "x" }],
        },
      },
      { op: "judge", id: "c1", state: "right", label: "x" },
      {
        op: "scene",
        step: "b",
        spec: { kind: "array", start: { items: ["1"] }, moves: [] },
      },
    ],
    { scope: "a" },
  );
  assert.equal(m.diagram, null, "a thread does not redraw the topic diagram");
  assert.deepEqual(m.fills, {}, "nor judge blanks");
  assert.equal(m.scenes?.b, undefined, "nor build another step's scene");
});

test("every part of a diagram gets an id of its own", () => {
  const g = as(
    cleanSpec({
      form: "grid",
      columns: ["A", "B"],
      rows: [
        { label: "x", cells: ["one", { text: "two" }] },
        { label: "y", cells: ["three", { id: "same", text: "four" }] },
        { label: "z", cells: [{ id: "same", text: "five" }] },
      ],
    }),
    "grid",
  );
  const ids = g.rows.flatMap((r) => r.cells.map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(Boolean));
});

test("a blank's accepted answers are kept apart and never reach the diagram", () => {
  const spec = {
    form: "grid",
    title: "Queens",
    columns: ["r + c"],
    rows: [
      {
        label: "Row 1",
        cells: [
          {
            id: "a1",
            blank: true,
            prompt: "r + c?",
            accept: ["4", "four"],
            why: "1 + 3 = 4",
          },
        ],
      },
    ],
  };
  const out = cleanSpecWithAnswers(spec);
  assert.ok(out);
  assert.deepEqual(out.answers.a1, { accept: ["4", "four"], why: "1 + 3 = 4" });
  const sent = JSON.stringify(out.diagram);
  assert.doesNotMatch(sent, /accept|why|four|1 \+ 3/);
  assert.match(
    diagramOutline(out.diagram, {}, out.answers),
    /accepts "4" \| "four"/,
    "the model sees them",
  );
});

test("accepted answers survive a redraw that does not repeat them", () => {
  const m: Canvas = { nodes: {}, diagram: null, fills: {} };
  const grid = (cell: object) => ({
    op: "diagram",
    spec: {
      form: "grid",
      title: "Q",
      columns: ["x"],
      rows: [{ label: "r", cells: [cell] }],
    },
  });
  applyOps(m, [
    grid({ id: "a1", blank: true, prompt: "?", accept: ["4"], why: "w" }),
  ]);
  applyOps(m, [grid({ id: "a1", blank: true, prompt: "?" })]);
  assert.deepEqual(m.answers?.a1.accept, ["4"]);
});

test("the same answer typed differently still matches", () => {
  assert.equal(normAnswer("(2, 0)"), normAnswer("2,0"));
  assert.equal(normAnswer("\u22121"), normAnswer("-1"));
  assert.ok(accepts({ accept: ["aet"], why: "" }, " AET. "));
  assert.ok(!accepts({ accept: ["aet"], why: "" }, "eat"));
  assert.ok(
    !accepts({ accept: [""], why: "" }, ""),
    "an empty answer never matches",
  );
});
