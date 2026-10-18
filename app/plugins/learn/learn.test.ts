// Learn as a plugin: registered, its classic prompts pinned word for word,
// and build mode's pure logic (cleaning, grading, fading, the schedule, the
// view) and its moves on the engine with a scripted model. The fixture is the
// text core sent before Learn was a plugin; a change to the classic prompts
// is a deliberate change to this fixture.

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import { BUILD_ACTIONS } from "./build.ts";
import {
  acceptArgued,
  addLinks,
  addMiscon,
  bareSay,
  buildKey,
  caseEdges,
  caseShape,
  cleanModel,
  HIDDEN,
  creditOf,
  DAY,
  dueOf,
  endReview,
  givesAway,
  grade,
  helpFor,
  keepVisit,
  keyOnlyFor,
  kept,
  keysIn,
  lastVisit,
  linkParts,
  localDay,
  markRecall,
  matchPart,
  mixedOrder,
  namedKeys,
  newItems,
  newState,
  nextHint,
  openLink,
  outcomes,
  outlineOf,
  paraphrases,
  placePart,
  record,
  redactLinks,
  relinkParts,
  repeats,
  revealNames,
  sameGraph,
  sameModel,
  scrub,
  setPredict,
  setWhatIf,
  showOneLink,
  slotFrom,
  staleReview,
  startBuild,
  stepOf,
  tellsOrder,
  todayOf,
  validate,
  verbsOf,
  viewOf,
  whatIf,
  whatifItem,
  whyPrecheck,
  type Build,
  type LearnState,
  type RefModel,
} from "./core.ts";
import fixture from "./prompts.fixture.json" with { type: "json" };
import { learn } from "./server.ts";
import { verbsFor, type Verb } from "./shared.ts";
import {
  blocked,
  drawn,
  labelWidth,
  looseZone,
  NODE_H,
  NODE_W,
  nothingDrawn,
  pathOf,
  regions,
  route,
  slotAt,
  spanOf,
  type At,
} from "./web/frame.ts";
import { act } from "../../server/actions/index.ts";
import { applyOps } from "../../server/core/canvas.ts";
import { systemPrompt } from "../../server/core/prompts.ts";
import type { Raw, StoredMap } from "../../server/core/types.ts";
import { createEngine } from "../../server/engine.ts";
import { modeOf, pluginFor, PLUGINS } from "../../server/plugins.ts";
import type {
  ModelProvider,
  ModelReply,
  ModelRequest,
} from "../../server/providers/types.ts";
import { newMap } from "../../server/store.ts";
import type { MapNode, ServerEvent } from "../../shared/model.ts";

afterEach(() => {
  vi.useRealTimers();
});

test("Learn is a registered plugin, and serves a map whose mode is not installed", () => {
  assert.equal(pluginFor("learn"), learn);
  assert.ok(PLUGINS.includes(learn));
  assert.deepEqual(learn.switchesWith, ["explore"]);
  assert.equal(modeOf("no-such-mode"), learn);
});

test("Learn's prompts are word for word what core sent before the move", () => {
  assert.equal(fixture.length, 3);
  for (const { sections, prompt } of fixture)
    assert.equal(systemPrompt("learn", sections, learn), prompt, `${sections}`);
});

// ---------------------------------------------------------------- fixtures

// the immune system, first infection: 7 parts, 6 links, 3 of them key
const PARTS = [
  {
    id: "virus",
    label: "Flu virus",
    role: "the invader, met for the first time",
  },
  {
    id: "dendritic",
    label: "Dendritic cell",
    role: "carries pieces of the invader to a lymph node",
  },
  { id: "helpert", label: "Helper T cell", role: "gives the go signal" },
  {
    id: "bcell",
    label: "B cell",
    role: "can make one shape of protein",
    accept: ["b lymphocyte"],
  },
  { id: "plasma", label: "Plasma cell", role: "a factory that lives for days" },
  {
    id: "antibody",
    label: "Antibody",
    role: "a protein that sticks to the invader",
  },
  {
    id: "memb",
    label: "Memory B cell",
    role: "waits for years, ready to divide",
    accept: ["memory lymphocyte"],
  },
];
const KEY = (id: string, from: string, to: string, rel: Verb) => ({
  id,
  from,
  to,
  rel,
  key: true,
  hint: `What does it lead to on day ${id.length + 10}?`,
  ask: `Why does ${id} hold?`,
  rubric: `the rubric of ${id}`,
  reversed: `The arrow of ${id} points the other way.`,
});
const LINKS = [
  { id: "l1", from: "virus", to: "dendritic", rel: "picked up by" },
  { id: "l2", from: "dendritic", to: "helpert", rel: "shows to" },
  KEY("l3", "helpert", "bcell", "activates"),
  KEY("l4", "bcell", "memb", "becomes"),
  { id: "l5", from: "bcell", to: "plasma", rel: "becomes" },
  KEY("l6", "plasma", "antibody", "makes"),
];
// a new case's links: the same key links, other links around them
const CASE_LINKS = [
  ...LINKS.filter((l) => "key" in l),
  { id: "l7", from: "virus", to: "helpert", rel: "activates" },
  { id: "l8", from: "dendritic", to: "plasma", rel: "sends to" },
];
const MISCON = [
  {
    id: "x1",
    claim: "Antibodies are the memory",
    refute: "Antibody levels fall within months; what lasts is cells.",
    link: { from: "antibody", to: "memb", rel: "becomes" },
  },
];
const PREDICT = {
  ask: "What is still there on day 60?",
  choices: [
    { text: "Memory B cell" },
    { text: "More antibody", miscon: "x1" },
    { text: "Plasma cell" },
  ],
  answer: "Memory B cell",
  hides: "l4",
};
const WHATIF = {
  fails: "helpert",
  ask: "Your helpers are wiped out, as in HIV. What stops working?",
  affected: ["bcell", "plasma", "antibody"],
  why: "They need a go signal before they multiply.",
};

const MODEL_OPS = (step: string, id = "m1") => [
  {
    op: "model",
    id,
    step,
    mode: "build",
    title: "Flu, your first infection",
    case: "days 0-14, a virus you have never met",
    layer: "behaviour",
    frame: { kind: "free" },
    parts: PARTS,
  },
  { op: "links", model: id, links: LINKS },
  { op: "miscon", model: id, items: MISCON },
  { op: "predict", model: id, ...PREDICT },
  { op: "whatif", model: id, ...WHATIF },
];

// a later step on the same cast: other key links and another what-if (the
// same ones would be refused as a repeat of step 1)
const NEXT_OPS = (step: string, id = "m1") => {
  const ops: Raw[] = MODEL_OPS(step, id);
  ops[1] = {
    op: "links",
    model: id,
    links: LINKS.map((l) =>
      l.id === "l1" || l.id === "l2"
        ? KEY(l.id, l.from, l.to, l.rel as Verb)
        : l.id === "l3" || l.id === "l6"
          ? { id: l.id, from: l.from, to: l.to, rel: l.rel }
          : l,
    ),
  };
  ops[4] = { ...ops[4], fails: "dendritic", affected: ["helpert", "bcell"] };
  return ops;
};

function model(over: Raw = {}): RefModel {
  const m = cleanModel({ ...MODEL_OPS("s1")[0], ...over })!;
  addLinks(m, over.links ?? LINKS);
  addMiscon(m, MISCON);
  setPredict(m, PREDICT);
  setWhatIf(m, WHATIF);
  m.status = "ready";
  return m;
}

const draw = (b: Build, from: string, to: string, rel: Verb) => {
  b.links.push({ id: `y${b.next++}`, from, to, rel });
};
const linksOf = (b: Build, list: [string, string, Verb][]) => {
  for (const [f, t, r] of list) draw(b, f, t, r);
  return b;
};
const ALL_RIGHT: [string, string, Verb][] = LINKS.map((l) => [
  l.from,
  l.to,
  l.rel as Verb,
]);
const KEYS_RIGHT: [string, string, Verb][] = [
  ["helpert", "bcell", "activates"],
  ["bcell", "memb", "becomes"],
  ["plasma", "antibody", "makes"],
];

const node = (
  id: string,
  parent: string | null,
  title: string,
  order: number,
  over: Partial<MapNode> = {},
): MapNode => ({
  id,
  parent,
  kind: "question",
  title,
  summary: "",
  detail: "",
  status: "open",
  by: "claude",
  updatedAt: 0,
  order,
  ...over,
});

function pathMap(title = "How does the immune system remember a virus?") {
  const m = newMap(title, "learn");
  m.nodes.root = node("root", null, title, 0);
  m.nodes.s1 = node("s1", "root", "First infection?", 1);
  m.nodes.s2 = node("s2", "root", "Second infection?", 2);
  m.nodes.s3 = node("s3", "root", "Why the first is slow?", 3);
  return m;
}

// a build map whose steps all have a ready model, at the level given
function buildMap(level: LearnState["level"] = "new") {
  const m = pathMap();
  const s = newState("build");
  s.level = level;
  for (const step of ["s1", "s2", "s3"]) {
    const mo = model({ step, id: `m-${step}` });
    mo.id = `m-${step}`;
    s.models[mo.id] = mo;
    s.stepModel[step] = mo.id;
  }
  m.data = { learn: s };
  return { m, s };
}

// ---------------------------------------------------------------- clean and validate

test("clean: unknown verbs, missing parts, a 9th part, unsafe ids and slots outside the frame are dropped", () => {
  const nine = [
    ...PARTS,
    { id: "extra1", label: "Extra one", role: "r" },
    { id: "extra2", label: "Extra two", role: "r" },
  ];
  const m = cleanModel({ step: "s1", id: "m1", parts: nine })!;
  assert.equal(m.parts.length, 8, "a 9th part is cut");
  const bad = cleanModel({
    step: "s1",
    parts: [
      { id: "__proto__", label: "Proto", role: "" },
      { id: "has space", label: "Spacey", role: "" },
      { id: "ok", label: "Fine", role: "" },
    ],
  })!;
  assert.deepEqual(
    bad.parts.map((p) => p.id),
    ["ok"],
    "ids safeId refuses are dropped",
  );
  assert.equal(cleanModel({ step: "constructor", parts: [] }), null);
  const n = addLinks(m, [
    { id: "a", from: "virus", to: "dendritic", rel: "eats" },
    { id: "b", from: "virus", to: "nobody", rel: "causes" },
    { id: "c", from: "virus", to: "dendritic", rel: "causes" },
    { id: "__proto__", from: "virus", to: "bcell", rel: "causes" },
  ]);
  assert.equal(n, 1);
  assert.deepEqual(
    m.links.map((l) => l.id),
    ["c"],
  );
  // a verb the frame does not allow drops the link
  const boxes = cleanModel({
    step: "s1",
    frame: { kind: "boxes", boxes: [{ id: "lymph", label: "Lymph node" }] },
    parts: [
      { id: "a", label: "A", role: "", slot: "lymph" },
      { id: "b", label: "B", role: "", slot: "spleen" },
    ],
  })!;
  assert.deepEqual(boxes.parts[0].slot, ["lymph"]);
  assert.equal(boxes.parts[1].slot, undefined, "a slot outside the frame");
  assert.equal(
    addLinks(boxes, [{ id: "u", from: "a", to: "b", rel: "unlike" }]),
    0,
  );
  // a sort frame takes a list of fair columns
  const sort = cleanModel({
    step: "s1",
    frame: { kind: "sort", columns: ["strong", "weak", "against"] },
    parts: [{ id: "a", label: "A", role: "", slot: ["strong", "weak", "x"] }],
  })!;
  assert.deepEqual(sort.parts[0].slot, ["strong", "weak"]);
});

test("a role that names another part is left out when the model is cleaned, not refused", () => {
  const m = cleanModel({
    ...MODEL_OPS("s1")[0],
    parts: [
      { id: "test", label: "Test run", role: "builds one commit and runs it" },
      { id: "res", label: "Pass or fail", role: "the outcome of one test run" },
    ],
  })!;
  assert.equal(m.parts[0].role, "builds one commit and runs it");
  assert.equal(m.parts[1].role, "", "it named the part Test run");
  assert.ok(!validate(m).some((x) => /names another part/.test(x)));
});

test("validate: a valid model has no problems, and each rule fails on its own", () => {
  assert.deepEqual(validate(model()), []);
  const cases: [string, (m: RefModel) => void, RegExp][] = [
    [
      "parts",
      (m) =>
        m.parts.push(
          { ...m.parts[0], id: "p8", label: "Eight" },
          { ...m.parts[0], id: "p9", label: "Nine" },
        ),
      /9 parts; a model needs 4 to 8/,
    ],
    [
      "links",
      (m) => (m.links = m.links.filter((l) => l.key).slice(0, 2)),
      /2 links; a model needs 3 to 10/,
    ],
    [
      "keys",
      (m) =>
        Object.assign(m.links[0], {
          key: true,
          hint: "Where?",
          ask: "Why?",
          rubric: "r",
        }),
      /4 key links; a model needs 2 or 3/,
    ],
    [
      "miscon",
      (m) =>
        m.miscon.push(
          ...[1, 2, 3].map((i) => ({ ...m.miscon[0], id: `z${i}` })),
        ),
      /4 misconceptions; at most 3/,
    ],
    [
      "hint",
      (m) => delete m.links[2].hint,
      /"Helper T cell" activates "B cell" has no hint/,
    ],
    ["ask", (m) => delete m.links[3].ask, /has no ask/],
    ["rubric", (m) => delete m.links[5].rubric, /has no rubric/],
    [
      "predict",
      (m) => (m.predict!.answer = "Neutrophil"),
      /predict answer "Neutrophil" is not one of its choices/,
    ],
    [
      "affected",
      (m) => m.whatif!.affected.push("liver"),
      /affected list names parts that are not in the model/,
    ],
    ["play", (m) => (m.mode = "play"), /subgoal order on an axis frame/],
  ];
  for (const [name, change, problem] of cases) {
    const m = model();
    change(m);
    const p = validate(m);
    assert.equal(p.length, 1, `${name}: ${p.join(" | ")}`);
    assert.match(p[0], problem, name);
  }
  assert.match(
    validate(model(), {
      title: "How a B cell becomes a Memory B cell",
      summary: "",
    })[0],
    /step title gives away the key link "B cell" becomes "Memory B cell"/,
  );
});

test("giveaway: both ends and the verb (or its stem) are caught; one end alone is not", () => {
  const m = model();
  assert.deepEqual(givesAway(m, "The B cell becomes a Memory B cell."), ["l4"]);
  assert.deepEqual(givesAway(m, "A B cell can become a Memory B cell"), ["l4"]);
  assert.deepEqual(
    givesAway(m, "What does the Memory B cell do all year?"),
    [],
  );
  assert.deepEqual(givesAway(m, "The B cell and the Memory B cell"), []);
  // the summary is cut to its first clause, a giving-away hint drops its rung
  const step = {
    title: "First infection?",
    summary: "Your first flu, where the B cell becomes a Memory B cell",
  };
  m.links[2].hint = "The Helper T cell activates the B cell, right?";
  const cut = scrub(m, step);
  assert.equal(cut.summary, "Your first flu");
  assert.deepEqual(cut.hints, ["l3"]);
  assert.equal(m.links[2].hint, undefined);
  // a predict whose answer is in the step title is dropped
  const m2 = model();
  assert.equal(
    scrub(m2, { title: "Why a Memory B cell?", summary: "" }).predict,
    true,
  );
  assert.equal(m2.predict, undefined);
});

// ---------------------------------------------------------------- grade and pass

test("grade: right, reversed, family, miscon, extra and missing", () => {
  const m = model();
  const b = startBuild(m, 2);
  linksOf(b, [
    ["virus", "dendritic", "picked up by"], // right
    ["memb", "bcell", "becomes"], // reversed (key l4)
    ["helpert", "bcell", "enables"], // family of "activates" (key l3)
    ["antibody", "memb", "becomes"], // the misconception
    ["helpert", "plasma", "activates"], // not in the model
  ]);
  const r = grade(m, b);
  assert.equal(r.right, 1);
  assert.equal(r.reversed, 1);
  assert.equal(r.family, 1);
  assert.equal(r.miscon, 1);
  assert.equal(r.extra, 1);
  // l2, l5 and l6 have nothing drawn on them
  assert.equal(r.missing, 3);
  assert.equal(r.keyMissing, 1);
  assert.equal(r.pass, false);
  const mark = (i: number) => r.marks[i];
  assert.equal(mark(1).mark, "reversed");
  assert.equal(mark(1).note, "The arrow of l4 points the other way.");
  assert.equal(mark(3).refute, MISCON[0].refute);
  assert.equal(mark(4).mark, "extra");
  // half credit for the family verb, never a pass for a key link
  assert.equal(r.score, (1 + 0.5) / 6);
  const fam = linksOf(startBuild(m, 2), [
    ...ALL_RIGHT.filter((l) => l[2] !== "activates"),
    ["helpert", "bcell", "causes"],
  ]);
  assert.equal(grade(m, fam).pass, false);
  // extra links are never counted against you
  const extra = linksOf(startBuild(m, 2), [
    ...ALL_RIGHT,
    ["helpert", "plasma", "activates"],
  ]);
  assert.equal(grade(m, extra).pass, true);
});

test("grade: lanes and sort slots (a list of fair slots), parts not placed yet, and pairs out of order on an axis", () => {
  const lanes = model({
    frame: { kind: "lanes", lanes: ["Blood", "Lymph node"] },
    parts: PARTS.map((p, i) => ({
      ...p,
      slot: i < 2 ? "Blood" : "Lymph node",
    })),
  });
  const b = startBuild(lanes, 2);
  b.placed = [
    { part: "virus", x: 0, y: 0, slot: "Blood" },
    { part: "bcell", x: 0, y: 0, slot: "Blood" },
    { part: "memb", x: 0, y: 0 },
  ];
  // a part outside the lanes is not placed yet, not in the wrong lane
  assert.deepEqual(grade(lanes, b).slots, [
    { part: "virus", ok: true },
    { part: "bcell", ok: false },
  ]);
  assert.equal(grade(lanes, b).loose, 1);
  const sort = model({
    frame: { kind: "sort", columns: ["strong", "weak", "against"] },
    parts: PARTS.map((p) => ({ ...p, slot: ["strong", "weak"] })),
    links: [],
  });
  const sb = startBuild(sort, 2);
  sb.placed = [
    { part: "virus", x: 0, y: 0, slot: "weak" },
    { part: "bcell", x: 0, y: 0, slot: "against" },
  ];
  assert.deepEqual(
    grade(sort, sb).slots.map((x) => x.ok),
    [true, false],
  );
  const axis = model({
    frame: { kind: "axis", ticks: ["day 0", "day 3", "day 7", "day 14"] },
    parts: PARTS.slice(0, 4).map((p, i) => ({
      ...p,
      slot: ["day 0", "day 3", "day 7", "day 14"][i],
    })),
    links: [],
  });
  const ab = startBuild(axis, 2);
  ab.placed = [
    { part: "virus", x: 0, y: 0, slot: "day 3" },
    { part: "dendritic", x: 0, y: 0, slot: "day 0" },
    { part: "helpert", x: 0, y: 0, slot: "day 7" },
    { part: "bcell", x: 0, y: 0, slot: "day 14" },
  ];
  assert.equal(grade(axis, ab).outOfOrder, 1);
  // two on one tick that the model has apart are out of order too
  ab.placed[1].slot = "day 3";
  assert.equal(grade(axis, ab).outOfOrder, 1);
  // parts off the axis are not placed yet, and not counted in the order
  ab.placed = ab.placed.map((p, i) => ({
    part: p.part,
    x: 300 - i * 100,
    y: 0,
  }));
  assert.equal(grade(axis, ab).outOfOrder, 0);
  assert.equal(grade(axis, ab).loose, 4);
});

test("pass: on an axis the order is the model; a scrambled one or a part off it does not pass", () => {
  const ticks = ["Feb 18", "Feb-Jun", "Jun 15", "Jun 16"];
  const axis = model({
    frame: { kind: "axis", ticks },
    parts: PARTS.slice(0, 4).map((p, i) => ({ ...p, slot: ticks[i] })),
    links: [
      { id: "p1", from: "virus", to: "dendritic", rel: "then" },
      KEY("p2", "dendritic", "helpert", "then"),
      KEY("p3", "helpert", "bcell", "then"),
    ],
  });
  const b = startBuild(axis, 2);
  const order = ["virus", "dendritic", "helpert", "bcell"];
  b.placed = order.map((part, i) => ({ part, x: 0, y: 0, slot: ticks[i] }));
  linksOf(b, [
    ["virus", "dendritic", "then"],
    ["dendritic", "helpert", "then"],
    ["helpert", "bcell", "then"],
  ]);
  assert.equal(grade(axis, b).pass, true);
  // the same links, the parts on the wrong ticks: not passed, and said
  b.placed = ["helpert", "bcell", "virus", "dendritic"].map((part, i) => ({
    part,
    x: 0,
    y: 0,
    slot: ticks[i],
  }));
  const scrambled = grade(axis, b);
  assert.equal(scrambled.pass, false);
  assert.ok(scrambled.outOfOrder > 0);
  // one part beside the axis: not passed either
  b.placed = order.map((part, i) => ({
    part,
    x: 0,
    y: 0,
    ...(i < 3 ? { slot: ticks[i] } : {}),
  }));
  assert.equal(grade(axis, b).pass, false);
  // a lane frame marks a part in the wrong lane but still passes on its links
  const lanes = model({
    frame: { kind: "lanes", lanes: ["Blood", "Lymph node"] },
    parts: PARTS.map((p) => ({ ...p, slot: "Blood" })),
  });
  const lb = linksOf(startBuild(lanes, 1), ALL_RIGHT);
  lb.placed[0].slot = "Lymph node";
  assert.equal(grade(lanes, lb).pass, true);
});

test("pass: at L0 only the key links count; at L2 the 70% rule; argued links count as reference", () => {
  const m = model();
  // L0: the non-key links are given; the three key links pass it
  const l0 = startBuild(m, 0);
  assert.equal(grade(m, l0, { keyOnly: true }).pass, false);
  linksOf(l0, KEYS_RIGHT);
  const r0 = grade(m, l0, { keyOnly: true });
  assert.equal(r0.pass, true);
  assert.equal(r0.total, 3);
  // L2: keys alone are not enough; 2 of the 3 others is under 70%, 3 of 3 passes
  const l2 = linksOf(startBuild(m, 2), KEYS_RIGHT);
  assert.equal(grade(m, l2).pass, false);
  linksOf(l2, [
    ["virus", "dendritic", "picked up by"],
    ["dendritic", "helpert", "shows to"],
  ]);
  assert.equal(grade(m, l2).pass, false, "2 of 3 is under 70%");
  draw(l2, "bcell", "plasma", "becomes");
  assert.equal(grade(m, l2).pass, true);
  // an argued link that Claude accepted is right on the next check
  const argued = linksOf(startBuild(m, 2), [
    ["helpert", "plasma", "activates"],
  ]);
  assert.equal(grade(m, argued).marks[0].mark, "extra");
  m.links.push({
    id: "a7",
    from: "helpert",
    to: "plasma",
    rel: "activates",
    key: false,
    argued: true,
  });
  const after = grade(m, argued);
  assert.equal(after.marks[0].mark, "right");
  assert.equal(after.total, 6, "an argued link is not one more to find");
});

test("grade: the inverse verb on the reversed pair is the same link; reversing it is not", () => {
  // the reference says "Road cost part of Road map"
  const m = model({
    links: [
      ...LINKS.slice(0, 5),
      { ...LINKS[5], from: "antibody", to: "plasma", rel: "part of" },
    ],
  });
  const b = linksOf(startBuild(m, 2), [["plasma", "antibody", "contains"]]);
  assert.equal(grade(m, b).marks[0].mark, "right");
  const back = linksOf(startBuild(m, 2), [["antibody", "plasma", "contains"]]);
  assert.equal(grade(m, back).marks[0].mark, "reversed");
});

test("pass: the check says what a pass needs of the other links", () => {
  const m = model();
  const b = linksOf(startBuild(m, 2), [
    ...KEYS_RIGHT,
    ["virus", "dendritic", "picked up by"],
    ["dendritic", "helpert", "shows to"],
  ]);
  const r = grade(m, b);
  assert.equal(r.pass, false);
  assert.deepEqual([r.rest, r.restGot, r.restNeed], [3, 2, 3]);
  assert.equal(grade(m, b, { keyOnly: true }).restNeed, 0);
});

test("argue: an accepted link is right at once on the last check, and counted", () => {
  const m = model();
  const b = linksOf(startBuild(m, 2), [["helpert", "plasma", "activates"]]);
  b.last = grade(m, b);
  assert.equal(b.last.extra, 1);
  acceptArgued(b, { from: "helpert", to: "plasma", rel: "activates" });
  assert.equal(b.last.marks[0].mark, "right");
  assert.deepEqual([b.last.extra, b.last.argued], [0, 1]);
  m.links.push({
    id: "a7",
    from: "helpert",
    to: "plasma",
    rel: "activates",
    key: false,
    argued: true,
  });
  assert.equal(grade(m, b).argued, 1, "the next check counts it too");
  // a link marked as a mix-up can be argued too, and an accepted one is right
  const mx = linksOf(startBuild(m, 2), [["antibody", "memb", "becomes"]]);
  mx.last = grade(m, mx);
  assert.equal(mx.last.marks[0].mark, "miscon");
  acceptArgued(mx, { from: "antibody", to: "memb", rel: "becomes" });
  assert.equal(mx.last.marks[0].mark, "right");
  assert.equal(mx.last.marks[0].refute, undefined);
  assert.equal(mx.last.miscon, 0);
  m.links.push({
    id: "a8",
    from: "antibody",
    to: "memb",
    rel: "becomes",
    key: false,
    argued: true,
  });
  assert.equal(grade(m, mx).marks[0].mark, "right");
});

test("show one link takes the place of your tries on the same two parts", () => {
  const m = model();
  const b = linksOf(startBuild(m, 2), [
    ["helpert", "bcell", "causes"], // a near verb on key l3
    ["virus", "dendritic", "picked up by"], // right, on another pair
  ]);
  b.checks = 1;
  const shown = showOneLink(m, b);
  assert.ok(
    typeof shown !== "string" && "link" in shown && shown.link.id === "l3",
  );
  assert.deepEqual(
    b.links.map((l) => [l.from, l.to, l.rel, !!l.given]),
    [
      ["virus", "dendritic", "picked up by", false],
      ["helpert", "bcell", "activates", true],
    ],
  );
});

test("credit: fixed after a check with no hint is yours; a hint or a link shown is not", () => {
  const m = model();
  const b = linksOf(startBuild(m, 2), ALL_RIGHT);
  b.checks = 2;
  b.first = { l3: false, l4: true, l6: true };
  assert.equal(creditOf(b), "you");
  b.hints.push({ link: "l3", rung: 1 });
  assert.equal(creditOf(b), "hints");
  b.shown.push("l3");
  assert.equal(creditOf(b), "shown");
  assert.equal(outcomes(m, { ...b, hints: [], shown: [] }).l3.how, "hinted");
});

test("verbs: the ones Claude names for the subject, the ones its links use, filled to six from their families", () => {
  const free = model();
  assert.deepEqual(verbsOf(free), verbsFor("free"), "none named: the frame's");
  const named = model({ verbs: ["causes", "reads", "nonsense"] });
  const v = verbsOf(named);
  for (const rel of ["picked up by", "shows to", "activates", "becomes"])
    assert.ok(v.includes(rel as Verb), rel);
  assert.ok(v.length >= 6);
  assert.ok(!v.includes("writes") || v.length > 6);
  assert.ok(!("nonsense" in Object.fromEntries(v.map((x) => [x, 1]))));
  const b = startBuild(named, 2);
  b.placed = PARTS.map((p) => ({ part: p.id, x: 0, y: 0 }));
  assert.equal(
    linkParts(named, b, "virus", "bcell", "calls"),
    "That verb is not one this frame uses.",
  );
});

test("giveaway: a summary that says a key link in other words is cut to its first clause", () => {
  const m = model({
    parts: [
      { id: "take", label: "Take cheapest town", role: "the next town" },
      { id: "try", label: "Try each road", role: "one road at a time" },
      { id: "lower", label: "Lower the cost", role: "keep the smaller" },
      { id: "done", label: "Mark it settled", role: "never again" },
    ],
    frame: { kind: "free" },
    links: [
      KEY("k1", "take", "try", "then"),
      KEY("k2", "try", "lower", "then"),
      { id: "n1", from: "lower", to: "done", rel: "then" },
    ],
  });
  const step = {
    title: "What happens in one round?",
    summary: "Take the cheapest town, then try its roads to lower costs",
  };
  assert.deepEqual(givesAway(m, step.summary), [], "the labels are not said");
  assert.ok(paraphrases(m, step.summary).length > 0);
  assert.equal(scrub(m, step).summary, "Take the cheapest town");
  assert.deepEqual(paraphrases(m, "What does one round of it do?"), []);
});

test("new-case shape: the original's graph under new names and numbers is refused", () => {
  const orig = model({
    case: "start A; roads A–B 4, A–C 1, C–B 2, B–D 1, C–D 5",
  });
  const renamed = model({
    case: "OSPF-style network from R1: links R1–R2 10 ms, R1–R3 3 ms, R3–R2 4 ms, R2–R4 2 ms, R3–R4 9 ms",
    parts: PARTS.map((p) => ({ ...p, label: `New ${p.label.split(" ")[0]}x` })),
  });
  assert.equal(caseEdges(renamed.case).length, 5, "OSPF-style is not an edge");
  assert.match(caseShape(orig, renamed).join(), /original's graph/);
  const other = model({
    case: "start P; roads P–Q 2, Q–R 2, R–S 2, P–S 9, Q–S 1, P–T 3",
    parts: renamed.parts,
    links: CASE_LINKS,
  });
  assert.deepEqual(caseShape(orig, other), []);
  assert.equal(
    sameGraph(
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ],
      [
        ["x", "y"],
        ["y", "z"],
        ["z", "x"],
      ],
    ),
    true,
  );
  assert.equal(
    sameGraph(
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "d"],
      ],
      [
        ["x", "y"],
        ["x", "z"],
        ["x", "w"],
      ],
    ),
    false,
  );
});

test("review: an empty visit keeps the last score; a review from an earlier day is over", () => {
  const { m: map, s } = buildMap();
  for (const i of newItems(s.models["m-s1"], noon(0))) s.items[i.id] = i;
  s.visits.push({ at: noon(1), unaided: 5, of: 6 });
  s.review = { at: noon(2), since: 1, order: ["s1"], items: 3, cards: [] };
  s.steps.s1 = {
    stage: "build",
    help: 1,
    reviewing: true,
    rungs: { built: "you", why: "you", whatif: null, case: null, kept: null },
  };
  assert.equal(staleReview(s, noon(2) + 1000), false);
  assert.equal(staleReview(s, noon(3)), true);
  // a day on, the view shows no review and the step as built
  const v = viewOf(s, map.nodes, noon(3));
  assert.equal(v.review, null);
  assert.equal(v.steps[0].stage, "built");
  assert.equal(v.steps[0].reviewing, false);
  // ended with nothing rebuilt: no visit, the headline stays 5 of 6
  assert.deepEqual(endReview(s, noon(3)), { unaided: 0, of: 0 });
  assert.equal(s.visits.length, 1);
  assert.equal(s.review, null);
  assert.equal(s.steps.s1.stage, "built");
  s.visits.push({ at: noon(3), unaided: 0, of: 0 });
  assert.deepEqual(lastVisit(s), { at: noon(1), unaided: 5, of: 6 });
});

test("review: today, unaided moves with the first check of a rebuild", () => {
  const { s } = buildMap();
  for (const i of newItems(s.models["m-s1"], noon(0))) s.items[i.id] = i;
  s.review = { at: noon(1), since: 1, order: ["s1"], items: 3, cards: [] };
  s.steps.s1 = {
    stage: "build",
    help: 1,
    reviewing: true,
    rungs: { built: "you", why: "you", whatif: null, case: null, kept: null },
  };
  const b = linksOf(startBuild(s.models["m-s1"], 1), KEYS_RIGHT);
  b.checks = 1;
  b.first = { l3: true, l4: true, l6: false };
  s.builds["m-s1"] = b;
  assert.deepEqual(todayOf(s), { unaided: 2, of: 3 });
});

test("outline: a move that does not work on the model sees a step you are building without its links or slots", () => {
  const { m: map, s } = buildMap();
  s.at = "s1";
  s.steps.s1 = {
    stage: "build",
    help: 1,
    rungs: { built: null, why: null, whatif: null, case: null, kept: null },
  };
  const hidden = outlineOf(s, map.nodes, { full: false });
  assert.ok(hidden.includes('"Memory B cell"'));
  assert.ok(!hidden.includes("becomes"), hidden);
  assert.ok(!hidden.includes("rubric"));
  assert.ok(outlineOf(s, map.nodes).includes("rubric: the rubric of l4"));
  s.steps.s1.stage = "built";
  assert.ok(outlineOf(s, map.nodes, { full: false }).includes("rubric"));
  // the engine passes the move's sections: Explain and the message box
  // see it hidden, a Why sees it whole
  const lo = (sections: string[]) => learn.outline!(map, { sections });
  s.steps.s1.stage = "build";
  assert.ok(!lo(["explain"]).includes("rubric"));
  assert.ok(!lo(["diagram"]).includes("rubric"));
  assert.ok(lo(["why"]).includes("rubric"));
});

test("view: a wrong predict pick shows why it is not, and the right one; the tray keeps its order", () => {
  const { m: map, s } = buildMap("new");
  const mo = s.models["m-s1"];
  mo.predict!.choices[2] = {
    text: "Plasma cell",
    why: "Plasma cells die within weeks.",
  };
  s.steps.s1 = {
    stage: "see",
    help: 0,
    predicted: { pick: "Plasma cell", sure: "sure" },
    rungs: { built: null, why: null, whatif: null, case: null, kept: null },
  };
  const p = viewOf(s, map.nodes, 0).steps[0].predict!;
  assert.equal(p.refute, "Plasma cells die within weeks.");
  assert.equal(p.correct, "Memory B cell");
  s.steps.s1.predicted = undefined;
  assert.equal(viewOf(s, map.nodes, 0).steps[0].predict!.correct, undefined);
  // L2: placing a part leaves the rest of the tray in the order it had
  s.steps.s1 = { ...s.steps.s1, stage: "build", help: 2 };
  const b = startBuild(mo, 2);
  s.builds[mo.id] = b;
  const before = viewOf(s, map.nodes, 0).steps[0].tray.map((x) => x.id);
  b.placed.push({ part: before[0], x: 0, y: 0 });
  const after = viewOf(s, map.nodes, 0).steps[0].tray.map((x) => x.id);
  assert.deepEqual(after, before.slice(1));
});

// ---------------------------------------------------------------- fade, typed names, what-if, why, new case

test("fade: what each help level gives", () => {
  const m = model();
  const l0 = startBuild(m, 0);
  assert.equal(l0.placed.length, 7);
  assert.deepEqual(
    l0.links.map((l) => [l.from, l.to, l.given]),
    [
      ["virus", "dendritic", true],
      ["dendritic", "helpert", true],
      ["bcell", "plasma", true],
    ],
    "every link but the key ones, given",
  );
  // laid out along the links, as the worked case is drawn
  const x = (b: Build, p: string) => b.placed.find((y) => y.part === p)!.x;
  assert.ok(
    x(l0, "virus") < x(l0, "dendritic") && x(l0, "helpert") < x(l0, "bcell"),
  );
  // a link that closes a loop does not stack every part in one column
  const loop = startBuild(
    model({
      links: [
        ...LINKS,
        { id: "l7", from: "antibody", to: "virus", rel: "prevents" },
      ],
    }),
    0,
  );
  assert.ok(
    x(loop, "virus") < x(loop, "dendritic") &&
      x(loop, "dendritic") < x(loop, "helpert"),
    JSON.stringify(loop.placed),
  );
  const l1 = startBuild(m, 1);
  assert.equal(l1.placed.length, 7);
  assert.equal(l1.links.length, 0);
  assert.ok(
    l1.placed.every((p) => !p.slot && [0, 260, 520].includes(p.x)),
    "a plain grid",
  );
  assert.notDeepEqual(
    l1.placed.map((p) => p.part),
    m.parts.map((p) => p.id),
    "in a shuffled order, not the worked layout",
  );
  // on a frame, L1 puts each part in its slot: Link it tests the links
  const lanes = model({
    frame: { kind: "lanes", lanes: ["Blood", "Lymph node"] },
    parts: PARTS.map((p, i) => ({
      ...p,
      slot: i < 2 ? "Blood" : "Lymph node",
    })),
  });
  const l1lanes = startBuild(lanes, 1);
  assert.ok(l1lanes.placed.every((p) => p.slot));
  assert.ok(grade(lanes, l1lanes).slots.every((x) => x.ok));
  // but not on an axis: its ticks are the order, which is the answer
  const ticks = ["day 0", "day 3", "day 7", "day 14"];
  const axis = model({
    mode: "play",
    frame: { kind: "axis", ticks },
    parts: PARTS.slice(0, 4).map((p, i) => ({ ...p, slot: ticks[i] })),
    links: [],
  });
  const l1axis = startBuild(axis, 1);
  assert.equal(l1axis.placed.length, 4);
  assert.ok(
    l1axis.placed.every((p) => !p.slot),
    "beside the axis, not on it",
  );
  for (const help of [2, 3] as const) {
    const b = startBuild(m, help);
    assert.equal(b.placed.length + b.links.length, 0);
  }
  // L3: the view has the frame and a count, no labels
  const { m: map, s } = buildMap("cold");
  s.steps.s1 = {
    stage: "build",
    help: 3,
    rungs: { built: null, why: null, whatif: null, case: null, kept: null },
  };
  const v = viewOf(s, map.nodes, 0).steps[0];
  assert.equal(v.tray.length, 0);
  assert.equal(v.trayCount, 7);
  const text = JSON.stringify(v);
  for (const p of PARTS) assert.ok(!text.includes(p.label), p.label);
  // nor does a case line that names one
  s.models["m-s1"].title = "One Memory B cell, ten years on";
  const named = viewOf(s, map.nodes, 0).steps[0];
  assert.equal(named.caseTitle, "");
  assert.ok(!JSON.stringify(named).includes("Memory B cell"));
  // L2: the tray has them, with their roles
  s.steps.s1.help = 2;
  assert.equal(viewOf(s, map.nodes, 0).steps[0].tray.length, 7);
});

test("typed match: accept list, a learned name, one slip, nothing fuzzy under 5 letters, did you mean", () => {
  const m = model();
  assert.deepEqual(matchPart(m, "B Lymphocyte"), { part: "bcell" });
  assert.deepEqual(matchPart(m, "memry b cell"), { part: "memb" });
  m.parts[5].learned.push("ab");
  assert.deepEqual(matchPart(m, "AB"), { part: "antibody" });
  const short = model({
    parts: [
      ...PARTS.slice(0, 6),
      { id: "gene", label: "Gene", role: "a code" },
    ],
  });
  const r = matchPart(short, "gane");
  assert.ok("suggest" in r && r.suggest[0] === "Gene", JSON.stringify(r));
  const near = matchPart(m, "plazmo cel");
  assert.ok("suggest" in near);
  assert.deepEqual(near.suggest, ["Plasma cell"], "only names that are close");
  // nonsense names nothing: L3 tests recall of the names
  assert.deepEqual(matchPart(m, "qqq"), { suggest: [] });
  const typo = matchPart(m, "dendrtc sel");
  assert.ok("suggest" in typo);
  assert.deepEqual(typo.suggest, ["Dendritic cell"]);
  // a start of a name is offered
  const start = matchPart(m, "helper");
  assert.ok("suggest" in start && start.suggest.includes("Helper T cell"));
});

test("did you mean: every name it shows counts as hinted, typed afterwards too", () => {
  const m = model();
  const b = startBuild(m, 3);
  revealNames(m, b, ["Helper T cell", "B cell"]);
  assert.deepEqual(b.hinted, ["helpert", "bcell"]);
  revealNames(m, b, ["B cell"]);
  assert.deepEqual(b.hinted, ["helpert", "bcell"], "once each");
  // a key link on a part whose name was shown is not "by you"
  for (const p of m.parts) placePart(m, b, p.id, { x: 0, y: 0 });
  for (const l of m.links.filter((x) => x.key))
    linkParts(m, b, l.from, l.to, l.rel);
  b.checks = 1;
  b.first = Object.fromEntries(
    m.links.filter((l) => l.key).map((l) => [l.id, true]),
  );
  const out = outcomes(m, b);
  const touched = m.links.filter(
    (l) =>
      l.key && [l.from, l.to].some((p) => ["helpert", "bcell"].includes(p)),
  );
  assert.ok(touched.length > 0);
  for (const l of touched) assert.equal(out[l.id].how, "hinted", l.id);
});

test("what-if: found, missed (named) and extra", () => {
  assert.deepEqual(whatIf(model(), ["bcell", "antibody", "virus", "nope"]), {
    found: ["bcell", "antibody"],
    missed: ["plasma"],
    extra: ["virus"],
  });
});

test("why pre-check: too short, the labels said back, and a real explanation", () => {
  const m = model();
  assert.equal(whyPrecheck("it lasts longer", m), "Say a little more.");
  assert.equal(
    whyPrecheck("The Memory B cell waits for years, ready to divide.", m),
    "That says what; say why.",
  );
  assert.equal(
    whyPrecheck(
      "A plasma cell spends itself pumping out antibody and dies within days, so only a resting cell that never started that work can still be around.",
      m,
    ),
    null,
  );
});

test("new-case shape: the same labels with new numbers are refused; new labels with the same verb families pass", () => {
  const orig = model();
  const sameLabels = model({ case: "days 0-21, a virus you have never met" });
  assert.match(caseShape(orig, sameLabels).join(), /more than half/);
  // new labels on the very same parts and links is the same model renamed
  const relabelled = model({
    case: "a measles vaccine, then an outbreak ten years on",
    parts: PARTS.map((p) => ({ ...p, label: `New ${p.label.split(" ")[0]}x` })),
  });
  assert.match(caseShape(orig, relabelled).join(), /one for one/);
  // renamed with one link dropped: still the original's links on its parts
  const trimmed = model({
    case: "a measles vaccine, then an outbreak ten years on",
    parts: relabelled.parts,
    links: LINKS.filter((l) => l.id !== "l2"),
  });
  assert.match(caseShape(orig, trimmed).join(), /under new names/);
  // the same key links, with other links around them
  const fresh = model({
    case: "a measles vaccine, then an outbreak ten years on",
    parts: relabelled.parts,
    links: CASE_LINKS,
  });
  assert.deepEqual(caseShape(orig, fresh), []);
  const otherVerbs = model({
    case: "a measles vaccine",
    parts: fresh.parts,
    links: LINKS.map((l) => (l.id === "l4" ? { ...l, rel: "sends to" } : l)),
  });
  assert.match(caseShape(orig, otherVerbs).join(), /same kinds of verb/);
});

test("a step that repeats another's key links or what-if is refused; the outline lists them when a model is written", () => {
  const one = model();
  const same = model({ step: "s2", id: "m-s2" });
  same.id = "m-s2";
  // the antigen renamed changes nothing: the key links are on other parts
  same.parts[0].label = "Toxoid";
  const p = repeats(same, [one]);
  assert.ok(
    p.some((x) => /key links .* are the key links of step "s1"/.test(x)),
  );
  assert.ok(p.some((x) => /what-if breaks the same part/.test(x)));
  const ops = NEXT_OPS("s2", "m-s2");
  const next = cleanModel(ops[0])!;
  addLinks(next, ops[1].links);
  setWhatIf(next, ops[4]);
  assert.deepEqual(repeats(next, [one]), []);
  // a new case is compared with its original elsewhere, never as a repeat
  assert.deepEqual(repeats(same, [{ ...one, of: "m0" }]), []);
  const { m, s } = buildMap("new");
  s.steps.s1 = { stage: "built", help: 0, rungs: freshRungs() };
  delete s.models["m-s2"];
  delete s.stepModel.s2;
  const text = outlineOf(s, m.nodes, { at: "s2", others: true });
  assert.match(text, /its key links: "Helper T cell" activates "B cell"/);
  assert.doesNotMatch(
    outlineOf(s, m.nodes, { at: "s2" }),
    /its key links/,
    "only a move that writes a model",
  );
});

// ---------------------------------------------------------------- schedule

const noon = (day: number) => {
  const d = new Date(2026, 9, 1 + day, 12);
  return d.getTime();
};

test("schedule: each answer moves the box, once a day, and retires after three days", () => {
  const m = model();
  const [item] = newItems(m, noon(0));
  assert.equal(item.box, 1);
  assert.equal(item.due, noon(0) + DAY);
  // the day it was built never promotes, however often
  record(item, "unaided", noon(0) + 1000);
  assert.equal(item.box, 1);
  record(item, "unaided", noon(1));
  assert.equal(item.box, 2);
  assert.equal(item.due, noon(1) + 3 * DAY);
  record(item, "unaided", noon(1) + 5000);
  assert.equal(item.box, 2, "no double promotion in one day");
  record(item, "hinted", noon(2));
  assert.equal(item.box, 2);
  assert.equal(item.due, noon(2) + DAY);
  record(item, "unaided", noon(4));
  assert.equal(item.box, 3);
  assert.equal(
    item.retired,
    false,
    "3 days, but not yet the third answer at box 3",
  );
  record(item, "unaided", noon(8));
  assert.equal(item.box, 4);
  assert.equal(item.retired, true);
  // not after 3 in one day
  const [same] = newItems(m, noon(0));
  for (let i = 0; i < 3; i++) record(same, "unaided", noon(1) + i);
  assert.equal(same.retired, false);
  assert.equal(same.box, 2);
  // shown or wrong: back to box 1; wrong while sure flags the refutation
  record(same, "shown", noon(2));
  assert.equal(same.box, 1);
  record(same, "wrong", noon(3), "fairly");
  assert.equal(same.refute, undefined);
  record(same, "wrong", noon(4), "sure");
  assert.equal(same.box, 1);
  assert.equal(same.refute, true);
});

test("schedule: due counts and next, the help level from boxes, and kept", () => {
  const { m: map, s } = buildMap();
  for (const i of newItems(s.models["m-s1"], noon(0))) s.items[i.id] = i;
  const live = new Set(["s1", "s2", "s3"]);
  assert.deepEqual(dueOf(s, live, noon(0)), { now: 0, next: noon(1) });
  // steps, not key links: one step with three items due
  assert.deepEqual(dueOf(s, live, noon(1)), { now: 1, next: null });
  // a what-if is never what makes a step due, nor what sets its help
  const wi = whatifItem(s.models["m-s1"], noon(0))!;
  s.items[wi.id] = wi;
  assert.deepEqual(dueOf(s, live, noon(1)), { now: 1, next: null });
  assert.deepEqual(
    dueOf(s, new Set(["s2"]), noon(1)),
    { now: 0, next: null },
    "a dropped step's items wait",
  );
  const items = Object.values(s.items).filter((i) => i.kind === "link");
  assert.equal(helpFor(items), 1);
  for (const i of items) i.box = 2;
  assert.equal(helpFor([...items, wi]), 2, "the what-if at box 1 is not it");
  assert.equal(helpFor(items), 2);
  for (const i of items) i.box = 3;
  assert.equal(helpFor(items), 3);
  assert.equal(
    helpFor(items, true),
    2,
    "a wrong quick rebuild lowers it by one",
  );
  items[0].box = 0;
  assert.equal(helpFor(items), 1);
  assert.equal(kept(items), false);
  for (const i of items) record(i, "unaided", noon(0) + 1);
  assert.equal(kept(items), false, "the day it was built does not count");
  for (const i of items) record(i, "unaided", noon(1));
  assert.equal(kept(items), true);
  assert.equal(localDay(noon(1)) - localDay(noon(0)), 1);
  void map;
});

test("in-session spacing: building step N+1 asks step N for one quick rebuild, only once", () => {
  const { s } = buildMap();
  const path = ["s1", "s2", "s3"];
  s.steps.s1 = {
    stage: "built",
    help: 0,
    rungs: { built: "you", why: "you", whatif: null, case: null, kept: null },
  };
  assert.equal(
    markRecall(s, path, "s1"),
    null,
    "the first step has none before it",
  );
  assert.equal(markRecall(s, path, "s2"), "s1");
  assert.equal(s.steps.s1.recallDue, true);
  assert.equal(markRecall(s, path, "s2"), null);
  s.steps.s1.recallDue = false;
  s.steps.s1.recallDone = true;
  assert.equal(markRecall(s, path, "s2"), null, "only once, ever");
});

test("mixed order: stable for a seed, never in path order when 3 or more are due", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(mixedOrder(ids, 7), mixedOrder(ids, 7));
  for (let seed = 0; seed < 200; seed++) {
    assert.notDeepEqual(mixedOrder(["a", "b", "c"], seed), ["a", "b", "c"]);
    assert.deepEqual([...mixedOrder(ids, seed)].sort(), ids);
  }
  assert.deepEqual(mixedOrder(["a"], 3), ["a"]);
});

// ---------------------------------------------------------------- the view

test("view: no accept list, rubric, unasked hint, affected list, predict answer or misconception pattern; worked links only while you see them", () => {
  const { m: map, s } = buildMap("new");
  const mo = s.models["m-s1"];
  mo.parts[1].learned.push("dc cell typed");
  const at = (stage: "see" | "build" | "why" | "built") => {
    s.steps.s1 = {
      stage,
      help: 0,
      whyLink: "l4",
      rungs: { built: null, why: null, whatif: null, case: null, kept: null },
    };
    return viewOf(s, map.nodes, 0);
  };
  for (const stage of ["see", "build", "why", "built"] as const) {
    const text = JSON.stringify(at(stage));
    for (const secret of [
      "b lymphocyte",
      "memory lymphocyte",
      "dc cell typed",
      "the rubric of",
      "What does it lead to on day",
      "points the other way",
      "affected",
      "Antibodies are the memory",
      '"answer"',
      '"miscon"',
      '"rubric"',
      '"accept"',
    ])
      assert.ok(!text.includes(secret), `${stage}: ${secret}`);
  }
  const see = at("see").steps[0];
  assert.ok(see.worked);
  assert.equal(see.worked.links.length, 5, "the predict's link stays hidden");
  // the hidden part goes out under a name of no meaning, never its own id,
  // and the other end of its link without its role
  assert.equal(see.worked.hidden, HIDDEN);
  assert.equal(see.worked.parts.find((p) => p.id === HIDDEN)?.label, "?");
  assert.ok(!JSON.stringify(see.worked).includes('"memb"'));
  assert.equal(see.worked.parts.find((p) => p.id === "bcell")?.role, "");
  assert.deepEqual(see.predict?.choices, [
    "Memory B cell",
    "More antibody",
    "Plasma cell",
  ]);
  assert.equal(see.predict?.right, null);
  assert.equal(at("build").steps[0].worked, null);
  assert.equal(at("why").steps[0].worked, null);
  // a predict about the from end ("which cell becomes the Memory B cell?")
  // hides that end, not the other one
  mo.predict = {
    ...mo.predict!,
    ask: "Which cell turns into the one still there on day 60?",
    choices: [{ text: "B cell" }, { text: "Plasma cell" }],
    answer: "B cell",
  };
  const from = at("see").steps[0].worked!;
  assert.equal(from.hidden, HIDDEN);
  assert.ok(!from.parts.some((p) => p.id === "bcell"));
  assert.equal(from.parts.find((p) => p.id === "memb")?.label, "Memory B cell");
  // the links that touch it point at the hidden name
  assert.ok(from.links.some((l) => l.to === HIDDEN || l.from === HIDDEN));
  // a case line that names the answer is held back while the question is open
  mo.case = "the B cell turns, on day 9, into the cell still there on day 60";
  assert.equal(at("see").steps[0].case, "");
  mo.case = "days 0-14, a virus you have never met";
  assert.equal(at("see").steps[0].case, mo.case);
  mo.predict = { ...mo.predict, ...PREDICT };
  // once you predicted, the whole worked case; a wrong pick shows its refutation
  s.steps.s1 = {
    ...s.steps.s1,
    stage: "see",
    predicted: { pick: "More antibody", sure: "sure" },
  };
  const after = viewOf(s, map.nodes, 0).steps[0];
  assert.equal(after.worked?.links.length, 6);
  assert.equal(after.predict?.right, false);
  assert.equal(after.predict?.refute, MISCON[0].refute);
  // Show the model puts the worked case back, whatever the stage
  s.steps.s1 = { ...s.steps.s1, stage: "build", shownModel: true };
  assert.equal(viewOf(s, map.nodes, 0).steps[0].worked?.links.length, 6);
  // a hint taken is shown; the ones not asked for are not
  s.steps.s1 = { ...s.steps.s1, shownModel: false };
  const b = startBuild(mo, 0);
  b.checks = 1;
  b.hints.push({ link: "l4", rung: 2 });
  s.builds[mo.id] = b;
  const hinted = JSON.stringify(viewOf(s, map.nodes, 0));
  assert.ok(hinted.includes("What does it lead to on day 12?"));
  assert.ok(!hinted.includes("What does it lead to on day 13?"));
});

// ---------------------------------------------------------------- the engine, with a scripted model

function scripted() {
  const calls: { req: ModelRequest; release: (text: string) => void }[] = [];
  const provider: ModelProvider = {
    name: "scripted",
    models: [{ id: "", label: "Default" }],
    efforts: [{ id: "", label: "Default" }],
    run(req, onText) {
      let release: (text: string) => void = () => {};
      const reply = new Promise<ModelReply>((resolve) => {
        release = (text) => {
          onText(text);
          resolve({
            ok: true,
            final: text,
            firstMs: 1,
            endMs: 2,
            usage: Promise.resolve(null),
          });
        };
      });
      calls.push({ req, release: (t) => release(t) });
      return { reply, cancel: () => release("") };
    },
  };
  return { provider, calls };
}

function setup(initial: StoredMap | null = null) {
  const { provider, calls } = scripted();
  const events: ServerEvent[] = [];
  const engine = createEngine({
    provider,
    hub: { add: () => {}, remove: () => {}, emit: (e) => events.push(e) },
    initial,
    save: () => {},
  });
  return { engine, calls, events };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settled = async (calls: unknown[], n: number) => {
  for (let i = 0; i < 50 && calls.length < n; i++) await tick();
};
const reply = (ops: Raw[], caption = "Here you go.") =>
  `${caption}\n\`\`\`map\n{"ops":[\n${ops.map((o) => JSON.stringify(o)).join(",\n")}\n]}\n\`\`\``;
const PATH_OPS = [
  {
    op: "add",
    id: "root",
    parent: null,
    kind: "question",
    title: "How does it remember?",
  },
  {
    op: "add",
    id: "s1",
    parent: "root",
    kind: "question",
    title: "First infection?",
  },
  {
    op: "add",
    id: "s2",
    parent: "root",
    kind: "question",
    title: "Second infection?",
  },
  {
    op: "add",
    id: "s3",
    parent: "root",
    kind: "question",
    title: "Why the first is slow?",
  },
];
const learnAct = (name: string, args: Raw = {}) =>
  ({ type: "plugin", plugin: "learn", name, args }) as Parameters<
    typeof act
  >[1];
const S = (m: StoredMap) => m.data!.learn as LearnState;

test("a new Learn map is a build map: path and step 1's model in one move, and the build is checked with no model call", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(noon(0));
  const { engine, calls } = setup();
  const started = act(engine, {
    type: "new",
    text: "How does the immune system remember a virus?",
    purpose: "learn",
  });
  await settled(calls, 1);
  assert.match(
    calls[0].req.system,
    /build them back|build it back|builds? .*back from memory/,
  );
  assert.match(calls[0].req.system, /MODEL OPS/);
  assert.doesNotMatch(calls[0].req.system, /TOPIC DIAGRAM \(learning/);
  calls[0].release(reply([...PATH_OPS, ...MODEL_OPS("s1")]));
  await started;
  const m = engine.state.map!;
  const s = S(m);
  assert.equal(s.mode, "build");
  assert.equal(s.models[s.stepModel.s1].status, "ready");
  assert.equal(calls.length, 1, "a model that holds needs no second try");

  // the level chooser, the predict, hiding: no model call
  assert.deepEqual(await act(engine, learnAct("level", { level: "new" })), {
    ok: true,
  });
  assert.match(
    (await act(engine, learnAct("hide", { step: "s1" }))).error ?? "",
    /Pick an answer/,
  );
  assert.deepEqual(
    await act(
      engine,
      learnAct("predict", { step: "s1", pick: "More antibody", sure: "sure" }),
    ),
    { ok: false },
  );
  assert.deepEqual(await act(engine, learnAct("hide", { step: "s1" })), {
    ok: true,
  });
  // reaching Build prefetches step 2's model
  await settled(calls, 2);
  assert.equal(calls.length, 2);
  assert.match(calls[1].req.message, /MODEL for step \[s2\]/);
  calls[1].release(reply(NEXT_OPS("s2", "m1")));
  await tick();
  assert.equal(s.models[s.stepModel.s2].status, "ready");
  assert.notEqual(
    s.stepModel.s2,
    s.stepModel.s1,
    "a reused model id never overwrites step 1's",
  );
  assert.equal(s.models[s.stepModel.s1].parts.length, 7);

  // L0: the non-key links are given; a hint only after a first check
  assert.match(
    (await act(engine, learnAct("hint", { step: "s1" }))).error ?? "",
    /first try/,
  );
  await act(
    engine,
    learnAct("link", {
      step: "s1",
      from: "antibody",
      to: "memb",
      rel: "becomes",
    }),
  );
  assert.deepEqual(await act(engine, learnAct("check", { step: "s1" })), {
    ok: false,
  });
  const view = () => (learn.view!(m) as ReturnType<typeof viewOf>).steps[0];
  assert.equal(view().check?.marks[0].mark, "miscon");
  for (const rung of [1, 2, 3]) {
    assert.deepEqual(await act(engine, learnAct("hint", { step: "s1" })), {
      ok: true,
    });
    assert.equal(view().hints.at(-1)?.rung, rung);
  }
  const b = s.builds[s.stepModel.s1];
  await act(
    engine,
    learnAct("unlink", { step: "s1", link: b.links.at(-1)!.id }),
  );
  for (const [from, to, rel] of KEYS_RIGHT)
    await act(engine, learnAct("link", { step: "s1", from, to, rel }));
  assert.deepEqual(await act(engine, learnAct("check", { step: "s1" })), {
    ok: true,
  });
  assert.equal(s.steps.s1.stage, "why");
  assert.equal(calls.length, 2, "checks and hints never call the model");

  // Why: the server refuses a copy of the labels, with no call
  const why = view().why!;
  assert.ok(why.ask);
  assert.deepEqual(
    await act(
      engine,
      learnAct("why", {
        step: "s1",
        text: "The Memory B cell waits for years, ready to divide.",
      }),
    ),
    { ok: false },
  );
  assert.equal(view().why?.pre, "That says what; say why.");
  assert.equal(calls.length, 2);
  const judged = act(
    engine,
    learnAct("why", {
      step: "s1",
      text: "A plasma cell spends itself making antibody and dies; a resting cell can divide again when the virus returns.",
    }),
  );
  await settled(calls, 3);
  assert.match(calls[2].req.system, /WHY on a key link/);
  assert.match(calls[2].req.message, /rubric: the rubric of/);
  calls[2].release(
    reply([
      {
        op: "why",
        model: s.stepModel.s1,
        link: s.steps.s1.whyLink,
        state: "right",
        say: "Yes: the factory dies, the resting cell stays.",
      },
    ]),
  );
  assert.deepEqual(await judged, { ok: true });
  assert.equal(s.steps.s1.stage, "built");
  assert.equal(m.nodes.s1.status, "answered");
  assert.equal(m.nodes.s1.revealed, undefined);
  assert.equal(
    Object.keys(s.items).length,
    3,
    "the three key links: the what-if waits until you try it",
  );
  // the build's own outcome is each item's first entry
  assert.ok(Object.values(s.items).every((i) => i.log.length === 1));
  assert.equal(learn.summary!(m), "1 of 3 built");

  // the what-if is checked here too
  assert.deepEqual(
    await act(
      engine,
      learnAct("whatif", {
        step: "s1",
        parts: ["bcell", "plasma", "antibody"],
      }),
    ),
    { ok: true },
  );
  assert.deepEqual(view().whatif?.result?.missed, []);
  assert.equal(calls.length, 3);
  assert.equal(Object.keys(s.items).length, 4, "the what-if, once tried");

  // a day later the items are due, and the review opens at the help they earned
  vi.setSystemTime(noon(1));
  assert.equal(learn.due!(m, Date.now()).now, 1, "one step, three links");
  assert.match(learn.summary!(m), /1 of 3 built · 1 step due/);
  // a step part way through a new case still comes back on its own model
  s.steps.s1.onCase = true;
  s.steps.s1.stage = "build";
  assert.deepEqual(await act(engine, learnAct("review")), { ok: true });
  assert.equal(s.steps.s1.onCase, false);
  assert.equal(s.steps.s1.stage, "build");
  assert.equal(s.steps.s1.help, 1);
  for (const [from, to, rel] of ALL_RIGHT)
    await act(engine, learnAct("link", { step: "s1", from, to, rel }));
  assert.deepEqual(await act(engine, learnAct("check", { step: "s1" })), {
    ok: true,
  });
  assert.equal(s.steps.s1.stage, "built", "a right why does not come back");
  const items = Object.values(s.items).filter((i) => i.kind === "link");
  assert.ok(items.every((i) => i.box === 2));
  // the due what-if is asked again on the built step, not by the rebuild
  assert.equal(view().whatif?.due, true);
  assert.equal(view().whatif?.result, null);
  const lastTime = viewOf(S(m), m.nodes, Date.now()).review!.items;
  assert.ok(
    lastTime.every((i) => i.last !== null),
    "last time is the first build",
  );
  assert.deepEqual(await act(engine, learnAct("done")), { ok: true });
  assert.deepEqual(s.visits.at(-1), { at: noon(1), unaided: 3, of: 3 });
  assert.match(learn.summary!(m), /last review 3 of 3 unaided/);
  // nothing is left due: a what-if not asked again never reopens a review
  assert.equal(learn.due!(m, Date.now()).now, 0);
  assert.deepEqual(await act(engine, learnAct("review")), {
    error: "Nothing is due for review.",
  });
  assert.equal(
    calls.length,
    3,
    "a return visit with nothing to judge calls no model",
  );
});

test("a model that does not hold together is asked for once more, then the step says so", async () => {
  const m = pathMap();
  m.data = { learn: newState("build") };
  const { engine, calls } = setup(m);
  const opened = act(engine, learnAct("open", { step: "s1" }));
  await settled(calls, 1);
  const thin = MODEL_OPS("s1").slice(0, 1);
  calls[0].release(reply(thin));
  await opened;
  await settled(calls, 2);
  assert.match(calls[1].req.message, /did not hold together: it has 0 links/);
  calls[1].release(reply(thin));
  await tick();
  await tick();
  const s = S(m);
  assert.equal(s.models[s.stepModel.s1].status, "broken");
  const v = learn.view!(m) as ReturnType<typeof viewOf>;
  assert.equal(v.steps[0].model, "broken");
  assert.ok(
    !JSON.stringify(v).includes("did not hold") &&
      !JSON.stringify(v).includes("has 0 links"),
    "what went wrong is said to Claude, never sent to the browser",
  );
  // Try again writes it anew
  const again = act(engine, learnAct("open", { step: "s1" }));
  await settled(calls, 3);
  calls[2].release(reply(MODEL_OPS("s1")));
  await again;
  assert.equal(s.models[s.stepModel.s1].status, "ready");
});

test("a new case that only swaps the numbers is retried; one that holds is built at L2", async () => {
  const { m, s } = buildMap();
  s.steps.s1 = {
    stage: "built",
    help: 0,
    rungs: { built: "you", why: "you", whatif: null, case: null, kept: null },
  };
  const { engine, calls } = setup(m);
  const asked = act(engine, learnAct("newCase", { step: "s1" }));
  await settled(calls, 1);
  assert.match(calls[0].req.system, /NEW CASE for a step/);
  const sameShape = MODEL_OPS("s1", "c1").filter((o) => o.op !== "predict");
  (sameShape[0] as Raw).of = "m-s1";
  (sameShape[0] as Raw).case = "days 0-21, a virus you have never met";
  calls[0].release(reply(sameShape));
  await asked;
  await settled(calls, 2);
  assert.match(
    calls[1].req.message,
    /more than half of the original's part labels/,
  );
  const fresh = structuredClone(sameShape) as Raw[];
  fresh[0].case = "a measles vaccine, then an outbreak years on";
  // a different shape: one link fewer
  fresh[1].links = CASE_LINKS;
  fresh[0].parts = PARTS.map((p) => ({
    ...p,
    label: `New ${p.label.split(" ")[0]}x`,
    accept: [],
  }));
  calls[1].release(reply(fresh));
  await tick();
  await tick();
  assert.equal(s.steps.s1.onCase, true);
  assert.equal(s.steps.s1.stage, "build");
  assert.equal(s.builds[s.steps.s1.caseModel!].help, 2);
  assert.equal(s.stepModel.s1, "m-s1", "the step keeps its own model");
});

test("an argued link that Claude accepts is right on the next check", async () => {
  const { m, s } = buildMap("cold");
  s.steps.s1 = {
    stage: "build",
    help: 2,
    rungs: { built: null, why: null, whatif: null, case: null, kept: null },
  };
  const { engine, calls } = setup(m);
  for (const part of ["helpert", "plasma"])
    await act(engine, learnAct("place", { step: "s1", part }));
  await act(
    engine,
    learnAct("link", {
      step: "s1",
      from: "helpert",
      to: "plasma",
      rel: "activates",
    }),
  );
  await act(engine, learnAct("check", { step: "s1" }));
  const b = s.builds["m-s1"];
  assert.equal(b.last?.marks[0].mark, "extra");
  const argue = () =>
    act(
      engine,
      learnAct("argue", {
        step: "s1",
        link: b.links[0].id,
        text: "Helper T cells signal plasma cells too.",
      }),
    );
  const argued = argue();
  // pressed again while it runs: no second paid move
  const again = argue();
  await settled(calls, 1);
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(await again, {});
  calls[0].release(
    reply([
      {
        op: "accept",
        model: "m-s1",
        link: { from: "helpert", to: "plasma", rel: "activates" },
        holds: true,
        say: "Fair: it holds here.",
      },
    ]),
  );
  assert.deepEqual(await argued, { ok: true });
  // right at once, before the next check: no Argue for it on it again
  assert.equal(b.last?.marks[0].mark, "right");
  assert.match(
    (await argue()).error ?? "",
    /not in Claude's model/,
    "an accepted link cannot be argued again",
  );
  await act(engine, learnAct("check", { step: "s1" }));
  assert.equal(b.last?.marks[0].mark, "right");
});

test("a later step's model is written quietly: its caption is neither streamed nor kept", async () => {
  const { m, s } = buildMap("new");
  delete s.models["m-s2"];
  delete s.stepModel.s2;
  const { engine, calls, events } = setup(m);
  const opened = act(engine, learnAct("open", { step: "s2" }));
  await settled(calls, 1);
  calls[0].release(
    reply(NEXT_OPS("s2", "m9"), "The B cell becomes a Memory B cell here."),
  );
  await opened;
  assert.equal(s.models[s.stepModel.s2].status, "ready");
  assert.ok(!events.some((e) => e.type === "delta"));
  assert.ok(!m.chat.some((c) => c.text.includes("Memory B cell")));
});

test("a review left open from yesterday ends at your next action; a new one opens for today", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { m, s } = buildMap("new");
  for (const i of newItems(s.models["m-s1"], noon(0))) s.items[i.id] = i;
  const rungs = {
    built: "you" as const,
    why: "you" as const,
    whatif: null,
    case: null,
    kept: null,
  };
  s.steps.s1 = { stage: "built", help: 0, rungs };
  const { engine } = setup(m);
  vi.setSystemTime(noon(1));
  assert.deepEqual(await act(engine, learnAct("review")), { ok: true });
  assert.equal(s.review?.at, noon(1));
  vi.setSystemTime(noon(9));
  assert.deepEqual(await act(engine, learnAct("review")), { ok: true });
  assert.equal(s.review?.at, noon(9), "today's review, not yesterday's");
  assert.equal(s.review?.since, 9);
  assert.equal(s.visits.length, 0, "the empty visit is not recorded");
});

test("a new case can be left and gone back to, with no model call", async () => {
  const { m, s } = buildMap("new");
  const rungs = {
    built: "you" as const,
    why: "you" as const,
    whatif: null,
    case: null,
    kept: null,
  };
  const c = model({ step: "s1", id: "m-s1-case", of: "m-s1" });
  c.id = "m-s1-case";
  c.of = "m-s1";
  s.models[c.id] = c;
  s.steps.s1 = {
    stage: "build",
    help: 0,
    rungs,
    caseModel: c.id,
    onCase: true,
  };
  const { engine, calls } = setup(m);
  assert.deepEqual(
    await act(engine, learnAct("onCase", { step: "s1", on: false })),
    { ok: true },
  );
  assert.equal(s.steps.s1.stage, "built");
  assert.equal(s.steps.s1.onCase, false);
  assert.equal(viewOf(s, m.nodes, 0).steps[0].newCase, "ready");
  assert.deepEqual(
    await act(engine, learnAct("onCase", { step: "s1", on: true })),
    { ok: true },
  );
  assert.equal(s.steps.s1.onCase, true);
  assert.equal(s.steps.s1.stage, "build");
  assert.equal(calls.length, 0);
});

test("typing a part at L3: a slip matches, a miss offers did you mean, and a pick is remembered", async () => {
  const { m, s } = buildMap("cold");
  s.steps.s1 = {
    stage: "build",
    help: 3,
    rungs: { built: null, why: null, whatif: null, case: null, kept: null },
  };
  const { engine } = setup(m);
  assert.match(
    (await act(engine, learnAct("place", { step: "s1", part: "bcell" })))
      .error ?? "",
    /Type/,
  );
  assert.deepEqual(
    await act(engine, learnAct("type", { step: "s1", text: "memry b" })),
    { ok: false },
  );
  const v = (learn.view!(m) as ReturnType<typeof viewOf>).steps[0];
  assert.ok(
    v.typed?.suggest.includes("Memory B cell"),
    JSON.stringify(v.typed),
  );
  assert.deepEqual(
    await act(engine, learnAct("pick", { step: "s1", label: "Memory B cell" })),
    { ok: true },
  );
  assert.deepEqual(s.models["m-s1"].parts[6].learned, ["memry b"]);
  assert.deepEqual(s.builds["m-s1"].hinted, ["memb"]);
  assert.deepEqual(
    await act(engine, learnAct("type", { step: "s1", text: "b lymphocite" })),
    { ok: true },
  );
});

test("building step 2 asks step 1 for a quick rebuild at L1, graded on the key links only", async () => {
  const { m, s } = buildMap("new");
  const rungs = {
    built: "you" as const,
    why: "you" as const,
    whatif: null,
    case: null,
    kept: null,
  };
  s.steps.s1 = { stage: "built", help: 0, rungs };
  for (const i of newItems(s.models["m-s1"], Date.now())) s.items[i.id] = i;
  s.steps.s2 = {
    stage: "why",
    help: 0,
    whyLink: "l4",
    rungs: { ...rungs, built: "you", why: null },
  };
  const { engine } = setup(m);
  await act(engine, learnAct("why", { step: "s2", show: true }));
  assert.equal(s.steps.s2.stage, "built");
  assert.equal(m.nodes.s2.revealed, true, "a shown why is not one you earned");
  assert.equal(s.steps.s1.recallDue, true);
  assert.deepEqual(await act(engine, learnAct("recall", { step: "s1" })), {
    ok: true,
  });
  assert.equal(s.steps.s1.help, 1);
  for (const [from, to, rel] of KEYS_RIGHT)
    await act(engine, learnAct("link", { step: "s1", from, to, rel }));
  assert.deepEqual(await act(engine, learnAct("check", { step: "s1" })), {
    ok: true,
  });
  assert.equal(s.steps.s1.recallDone, true);
  assert.equal(s.steps.s1.recallWrong, false);
  // and the step says how it came out
  assert.deepEqual(viewOf(s, m.nodes, Date.now()).steps[0].recalled, {
    credit: "you",
    tries: 1,
  });
  assert.match(
    (await act(engine, learnAct("recall", { step: "s1" }))).error ?? "",
    /No quick rebuild/,
  );
});

test("old maps: a classic map is served as before, and Practise keeps its diagram, fills and answers", async () => {
  const m = pathMap("Hash maps");
  m.nodes.s1.status = "answered";
  m.diagram = {
    form: "structure",
    title: "T",
    boxes: [{ id: "b1", blank: true, prompt: "What goes here?", label: "" }],
    arrows: [],
  };
  m.fills = { b1: { text: "x", state: "wrong" } };
  m.answers = { b1: { accept: ["bucket"], why: "it is" } };
  const { engine, calls } = setup(m);
  const snap = engine.snapshot();
  assert.ok(
    snap.type === "map" && snap.map && !("data" in snap.map),
    "no view, as before",
  );
  assert.equal(learn.promptFor!(m).prompt, learn.prompt);
  assert.match(learn.outline!(m), /^TOPIC DIAGRAM:/);
  assert.equal(learn.summary!(m), "1 of 3 worked out by you · structure");
  // the classic hint is core's, worded as before (a model call)
  const hinted = act(engine, { type: "hint", nodeId: "s2" });
  await settled(calls, 1);
  assert.match(calls[0].req.message, /HINT on step \[s2\]/);
  calls[0].release("Hint.");
  await hinted;
  const before = structuredClone({ d: m.diagram, f: m.fills, a: m.answers });
  assert.deepEqual(await act(engine, learnAct("practise")), { ok: true });
  assert.deepEqual({ d: m.diagram, f: m.fills, a: m.answers }, before);
  const s = S(m);
  assert.equal(s.mode, "build");
  assert.equal(
    s.steps.s1.stage,
    "build",
    "a step worked out already starts at L1, with no See",
  );
  assert.equal(s.steps.s1.help, 1);
  assert.equal(s.steps.s2, undefined, "the rest start at the level chooser");
  const v = learn.view!(m) as ReturnType<typeof viewOf>;
  assert.equal(v.level, null);
  assert.equal(v.topic, true);
  assert.match(learn.outline!(m), /LEARN, BUILD MODE[\s\S]*TOPIC DIAGRAM:/);
  // its first open writes the step's model with the old diagram in view
  const opened = act(engine, learnAct("open", { step: "s1" }));
  await settled(calls, 2);
  assert.match(calls[1].req.message, /learned first with the TOPIC DIAGRAM/);
  calls[1].release(reply(MODEL_OPS("s1")));
  await opened;
  assert.equal(s.models[s.stepModel.s1].status, "ready");
});

test("switching: explore → learn on a map that was in Learn calls no model, and learn → explore → learn keeps data.learn", async () => {
  const { m, s } = buildMap();
  s.steps.s1 = {
    stage: "built",
    help: 0,
    rungs: { built: "you", why: "you", whatif: null, case: null, kept: null },
  };
  m.purpose = "explore";
  const { engine, calls } = setup(m);
  const before = structuredClone(m.data!.learn);
  assert.deepEqual(
    await act(engine, { type: "purpose", purpose: "learn" }),
    {},
  );
  await tick();
  assert.equal(calls.length, 0);
  await act(engine, { type: "purpose", purpose: "explore" });
  await act(engine, { type: "purpose", purpose: "learn" });
  await tick();
  assert.equal(calls.length, 0);
  assert.deepEqual(m.data!.learn, before);
});

test("an explored map switched to Learn for the first time gets a path and step 1's model, and keeps what you explored", async () => {
  const m = newMap("Which DB?", "explore");
  m.nodes.q = node("q", null, "Which DB?", 0);
  m.nodes.pg = node("pg", "q", "Postgres", 1, {
    kind: "option",
    status: "proposed",
  });
  const { engine, calls } = setup(m);
  const switched = act(engine, { type: "purpose", purpose: "learn" });
  await settled(calls, 1);
  assert.match(calls[0].req.message, /Remove nothing/);
  assert.match(calls[0].req.message, /MODEL of the FIRST step/);
  calls[0].release(
    reply([
      { op: "remove", id: "pg" },
      {
        op: "add",
        id: "s1",
        parent: "q",
        kind: "question",
        title: "What do you store?",
      },
      ...MODEL_OPS("s1"),
    ]),
  );
  await switched;
  assert.ok(m.nodes.pg, "what you explored stays");
  assert.equal(S(m).models[S(m).stepModel.s1].status, "ready");
});

test("a side thread cannot write a model or a verdict", () => {
  const { m, s } = buildMap();
  s.steps.s1 = {
    stage: "why",
    help: 0,
    whyLink: "l4",
    why: { state: "wrong", tries: 1 },
    rungs: { built: null, why: null, whatif: null, case: null, kept: null },
  };
  assert.equal(
    learn.applyOp!(
      m,
      { op: "why", model: "m-s1", link: "l4", state: "right", say: "yes" },
      { scope: "s1" },
    ),
    0,
  );
  assert.equal(learn.applyOp!(m, MODEL_OPS("s9")[0], { scope: "s1" }), 0);
  assert.equal(s.steps.s1.why?.state, "wrong");
  assert.equal(
    learn.applyOp!(m, { op: "add" }, { scope: null }),
    null,
    "not a Learn op",
  );
  // a ready model is fixed
  assert.equal(
    learn.applyOp!(m, MODEL_OPS("s1", "m-s1")[0], { scope: null }),
    0,
  );
  assert.equal(Object.keys(BUILD_ACTIONS).includes("practise"), true);
});

// ---------------------------------------------------------------- QA round 2

const freshRungs = () => ({
  built: null,
  why: null,
  whatif: null,
  case: null,
  kept: null,
});

test("named key links: both ends in one window, each word for one end only", () => {
  const m = model();
  assert.deepEqual(namedKeys(m, '"Helper T cell": gives the go signal.'), []);
  assert.deepEqual(
    namedKeys(m, "the B cell becomes a Memory B cell"),
    ["l4"],
    "the longer label does not take the shorter one's words",
  );
  assert.deepEqual(namedKeys(m, "A plasma cell makes antibody for days."), [
    "l6",
  ]);
  assert.deepEqual(
    keysIn(m, "Plasma cell: a factory.\nAntibody: a protein."),
    [],
  );
  const d = redactLinks(
    m,
    '"Helper T cell": gives the go signal.\n"B cell": the Helper T cell activates it.\n"Antibody": a protein.',
  );
  assert.match(d, /gives the go signal/);
  assert.match(d, /a protein/);
  assert.doesNotMatch(d, /activates/);
  assert.match(d, /left out while you build/);
  assert.equal(redactLinks(m, "Antibody: a protein."), "Antibody: a protein.");
});

test("why pre-check: the link read back with its verb is refused, with no call", () => {
  const m = model();
  assert.equal(
    whyPrecheck("The B cell becomes Memory B cell.", m),
    "That says what; say why.",
  );
  assert.equal(
    whyPrecheck(
      "Plasma cells burn out making antibody, so a resting cell that can divide again is what lasts.",
      m,
    ),
    null,
  );
});

test("typed match: parts on the canvas are never offered; a long name takes two slips; a tie is asked", () => {
  const m = model({
    parts: [
      ...PARTS.slice(0, 6),
      { id: "memb", label: "President signs", role: "approves it" },
    ],
  });
  assert.deepEqual(matchPart(m, "presidnt sign"), { part: "memb" });
  const r = matchPart(m, "cel", ["plasma", "bcell"]);
  assert.ok("suggest" in r);
  if ("suggest" in r) {
    assert.ok(!r.suggest.includes("Plasma cell"));
    assert.ok(!r.suggest.includes("B cell"));
  }
});

test("hints: once every key link is there, they go on to the other links a pass needs", () => {
  const m = model();
  const b = linksOf(startBuild(m, 1), KEYS_RIGHT);
  b.checks = 1;
  const h = nextHint(m, b);
  assert.ok(
    typeof h !== "string" && !m.links.find((l) => l.id === h.link)!.key,
  );
  // a quick rebuild grades only the key links: nothing left to hint
  assert.equal(nextHint(m, b, true), "Every link is already there.");
  assert.equal(openLink(m, b, true), undefined);
});

test("a Why verdict's line does not say the verdict again", () => {
  assert.equal(
    bareSay("Right: the Constitution says so."),
    "The Constitution says so.",
  );
  assert.equal(bareSay("Not yet. What does it make?"), "What does it make?");
  assert.equal(bareSay("No single cause holds."), "No single cause holds.");
});

test("a new case that is the original under new labels is refused; a changed shape passes", () => {
  const orig = model();
  const renamed = model({
    case: "a measles vaccine",
    parts: PARTS.map((p) => ({ ...p, id: `n${p.id}`, label: `Other ${p.id}` })),
    links: LINKS.map((l) => ({ ...l, from: `n${l.from}`, to: `n${l.to}` })),
  });
  assert.equal(sameModel(orig, renamed), true);
  const reshaped = model({
    parts: renamed.parts,
    links: renamed.links.map((l) =>
      l.id === "l1" ? { ...l, from: "nvirus", to: "nhelpert" } : l,
    ),
  });
  assert.equal(sameModel(orig, reshaped), false);
});

test("validate: a link dropped for its verb is named in the problems; a box frame takes 'makes'", () => {
  const boxes = model({
    frame: { kind: "boxes", boxes: [{ id: "a", label: "A" }] },
    // the predict hides l4: dropped for its verb, the predict is orphaned
    links: LINKS.map((l) => (l.id === "l4" ? { ...l, rel: "unlike" } : l)),
  });
  assert.ok(verbsFor("boxes").includes("makes"));
  const p = validate(boxes);
  assert.ok(p.some((x) => /the predict hides "l4"/.test(x)));
  assert.ok(
    p.some((x) =>
      /"l4" was dropped: a boxes frame does not take the verb "unlike"/.test(x),
    ),
    p.join("; "),
  );
  // a model that holds anyway is not refused for a dropped link
  const fine = model({
    links: [...LINKS, { id: "l9", from: "virus", to: "memb", rel: "nope" }],
  });
  assert.deepEqual(validate(fine), []);
});

test("view: a quick rebuild waiting keeps the build it rebuilds out of view; Show the model has the argued links", () => {
  const { m: map, s } = buildMap();
  const mo = s.models["m-s1"];
  s.steps.s1 = {
    stage: "built",
    help: 0,
    whyLink: "l4",
    why: { state: "right", tries: 1 },
    recallDue: true,
    rungs: { ...freshRungs(), built: "you" },
  };
  s.builds["m-s1"] = linksOf(startBuild(mo, 0), KEYS_RIGHT);
  s.builds["m-s1"].last = grade(mo, s.builds["m-s1"]);
  let v = viewOf(s, map.nodes, 0).steps[0];
  assert.equal(v.links.length, 0);
  assert.equal(v.check, null);
  assert.equal(v.why, null);
  s.steps.s1.recallDue = false;
  v = viewOf(s, map.nodes, 0).steps[0];
  assert.ok(v.links.length > 0);
  mo.links.push({
    id: "a7",
    from: "virus",
    to: "memb",
    rel: "causes",
    key: false,
    argued: true,
  });
  s.steps.s1 = { ...s.steps.s1, stage: "see", shownModel: true };
  v = viewOf(s, map.nodes, 0).steps[0];
  assert.ok(v.worked?.links.some((l) => l.id === "a7"));
});

test("today's score is kept once every due step is rebuilt, with no I'm done today", () => {
  const { s } = buildMap();
  for (const i of newItems(s.models["m-s1"], noon(0))) s.items[i.id] = i;
  s.review = { at: noon(1), since: 1, order: ["s1"], items: 3, cards: [] };
  for (const i of Object.values(s.items)) record(i, "unaided", noon(1) + 5);
  keepVisit(s);
  keepVisit(s);
  assert.deepEqual(
    s.visits,
    [{ at: noon(1), unaided: 3, of: 3 }],
    "once per review",
  );
  endReview(s, noon(1) + 10);
  assert.equal(s.visits.length, 1);
});

test("links are drawn clear of other parts, their labels off every card", () => {
  const at = {
    a: { x: 0, y: 0 },
    b: { x: 600, y: 0 },
    c: { x: 300, y: 0 },
  };
  // straight from a to b runs through c: it arcs round instead
  const r = route("a", "b", at, "sends to");
  assert.equal(r.type, "arc");
  assert.equal(blocked("a", "b", at, r, "sends to"), false);
  // two parts side by side, a short gap: the label would sit on both cards
  const near = { a: { x: 0, y: 0 }, b: { x: NODE_W + 20, y: 0 } };
  assert.equal(route("a", "b", near, "then").type, "arc");
  // room between them: straight
  const far = { a: { x: 0, y: 0 }, b: { x: NODE_W + 120, y: 0 } };
  assert.equal(route("a", "b", far, "then").type, "straight");
  // a second link on the same pair arcs out further than the first
  const first = route("a", "b", near, "then");
  const second = route("a", "b", near, "then ↔", 1);
  assert.ok(
    first.type === "arc" &&
      second.type === "arc" &&
      second.offset > first.offset,
  );
});

test("while you build, what Claude writes: a line naming a key link is left out of a node, and one said in a reply counts as hinted", async () => {
  const { m, s } = buildMap("some");
  s.steps.s1 = { stage: "build", help: 1, rungs: freshRungs() };
  s.at = "s1";
  const { engine, calls } = setup(m);
  const ex = act(engine, { type: "explain", nodeId: "s1" });
  await settled(calls, 1);
  calls[0].release(
    reply(
      [
        {
          op: "update",
          id: "s1",
          detail:
            '"Helper T cell": gives the go signal.\n"B cell": the Helper T cell activates it.\n"Antibody": a protein.',
        },
      ],
      "What each part is.",
    ),
  );
  await ex;
  assert.match(m.nodes.s1.detail, /gives the go signal/);
  assert.doesNotMatch(m.nodes.s1.detail, /activates/);
  assert.equal(s.builds["m-s1"]?.told ?? undefined, undefined);
  const msg = act(engine, {
    type: "message",
    text: "what does it make?",
    selection: [],
  });
  await settled(calls, 2);
  calls[1].release(reply([], "A plasma cell makes antibody for a few days."));
  await msg;
  const b = s.builds["m-s1"];
  assert.deepEqual(b.told, ["l6"]);
  assert.equal(viewOf(s, m.nodes, 0).steps[0].told, 1);
  // drawn right at the first check, it still counts as hinted
  linksOf(b, ALL_RIGHT);
  assert.deepEqual(await act(engine, learnAct("check", { step: "s1" })), {
    ok: true,
  });
  assert.equal(outcomes(s.models["m-s1"], b).l6.how, "hinted");
  assert.equal(outcomes(s.models["m-s1"], b).l4.how, "unaided");
  assert.equal(creditOf(b), "hints");
});

test("while you build, a note Claude adds under the step is dropped: Learn never shows it, and it grouped the parts a key link joins", async () => {
  const { m, s } = buildMap("some");
  s.steps.s1 = { stage: "build", help: 1, rungs: freshRungs() };
  s.at = "s1";
  const { engine, calls } = setup(m);
  const msg = act(engine, {
    type: "message",
    text: "what makes the memory last?",
    selection: [],
  });
  await settled(calls, 1);
  calls[0].release(
    reply([
      { op: "add", id: "f-mem", parent: "s1", kind: "fact", title: "Memory" },
      { op: "add", id: "f-b", parent: "f-mem", kind: "fact", title: "B cell" },
      { op: "add", id: "f-top", parent: "root", kind: "fact", title: "Aside" },
    ]),
  );
  await msg;
  assert.equal(m.nodes["f-mem"], undefined);
  assert.equal(m.nodes["f-b"], undefined);
  // one at the top of the map is in the rail's "You looked into"
  assert.ok(m.nodes["f-top"]);
});

test("the first move's caption is the server's: what Claude streamed about step 1 is not kept", async () => {
  const { engine, calls, events } = setup();
  const started = act(engine, {
    type: "new",
    text: "How does the immune system remember a virus?",
    purpose: "learn",
  });
  await settled(calls, 1);
  calls[0].release(
    reply(
      [...PATH_OPS, ...MODEL_OPS("s1")],
      "The B cell becomes the Memory B cell, the one CAPTION-SAYS-IT.",
    ),
  );
  await started;
  const m = engine.state.map!;
  const said = JSON.stringify([m.chat, events]);
  assert.doesNotMatch(said, /CAPTION-SAYS-IT/);
  assert.match(m.chat.at(-1)!.text, /Your path: 3 steps/);
});

test("a play step's scene played to the end does not build the step; a review clears a quick rebuild waiting", async () => {
  const { m, s } = buildMap();
  s.steps.s2 = { stage: "build", help: 1, rungs: freshRungs() };
  applyOps(m, [
    {
      op: "scene",
      step: "s2",
      spec: { kind: "array", title: "Find 7", start: { items: ["2", "7"] } },
    },
    { op: "move", step: "s2", ask: "Where is 7?", answer: { index: 1 } },
  ]);
  m.scenes.s2.complete = true;
  const { engine } = setup(m);
  await act(engine, { type: "play", nodeId: "s2", key: "1" });
  assert.equal(m.play.s2.at, 1);
  assert.equal(m.nodes.s2.status, "open");

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(noon(0));
  s.steps.s1 = {
    stage: "built",
    help: 0,
    recallDue: true,
    rungs: { ...freshRungs(), built: "you" },
  };
  for (const i of newItems(s.models["m-s1"], noon(0))) s.items[i.id] = i;
  vi.setSystemTime(noon(3));
  assert.deepEqual(await act(engine, learnAct("review")), { ok: true });
  assert.equal(s.steps.s1.recallDue, false);
});

test("once a build passed, a link its check marked '?' can still be argued for", async () => {
  const { m, s } = buildMap();
  const mo = s.models["m-s1"];
  s.steps.s1 = {
    stage: "why",
    help: 0,
    whyLink: "l4",
    rungs: { ...freshRungs(), built: "you" },
  };
  const b = linksOf(startBuild(mo, 0), [
    ...KEYS_RIGHT,
    ["helpert", "plasma", "activates"],
  ]);
  b.last = grade(mo, b, { keyOnly: true });
  b.checks = 1;
  s.builds["m-s1"] = b;
  const extra = b.last.marks.find((x) => x.mark === "extra")!;
  const { engine, calls } = setup(m);
  const argued = act(
    engine,
    learnAct("argue", { step: "s1", link: extra.link, text: "It does" }),
  );
  await settled(calls, 1);
  assert.match(calls[0].req.message, /ARGUE on step/);
  calls[0].release(
    reply([
      {
        op: "accept",
        model: "m-s1",
        link: { from: "helpert", to: "plasma", rel: "activates" },
        holds: true,
        say: "It holds.",
      },
    ]),
  );
  assert.deepEqual(await argued, { ok: true });
  assert.equal(b.last.marks.find((x) => x.link === extra.link)?.mark, "right");
});

test("relink: reversed onto a link already drawn, the two merge; the old mark goes, and the card knows you changed it", () => {
  const m = model();
  const b = linksOf(startBuild(m, 2), [
    ["bcell", "memb", "becomes"],
    ["memb", "bcell", "becomes"],
  ]);
  b.last = grade(m, b);
  const back = b.links[1].id;
  assert.equal(b.last.marks.find((x) => x.link === back)?.mark, "reversed");
  assert.equal(relinkParts(m, b, back, { reverse: true }), null);
  assert.equal(b.links.length, 1, "one link, not two the same");
  assert.ok(!b.last.marks.some((x) => x.link === back), "its mark went");
  // a copy saved before the merge is right, never a near verb
  draw(b, "bcell", "memb", "becomes");
  const r = grade(m, b);
  assert.ok(r.marks.every((x) => x.mark === "right"));
  assert.equal(r.family, 0);
  // the view says the build changed since its check
  const { m: map, s } = buildMap("cold");
  s.steps.s1 = { stage: "build", help: 2, rungs: freshRungs() };
  const sb = linksOf(startBuild(s.models["m-s1"], 2), [
    ["bcell", "memb", "becomes"],
  ]);
  sb.placed = [
    { part: "bcell", x: 0, y: 0 },
    { part: "memb", x: 300, y: 0 },
  ];
  s.builds["m-s1"] = sb;
  sb.last = grade(s.models["m-s1"], sb);
  sb.checks = 1;
  sb.checked = buildKey(sb);
  assert.equal(viewOf(s, map.nodes, 0).steps[0].changed, false);
  relinkParts(s.models["m-s1"], sb, sb.links[0].id, { reverse: true });
  assert.equal(viewOf(s, map.nodes, 0).steps[0].changed, true);
});

test("pass: a part left outside the frame stops it on every frame; the wrong column does not", () => {
  const sort = model({
    frame: { kind: "sort", columns: ["strong", "weak", "against"] },
    parts: PARTS.map((p) => ({ ...p, slot: ["strong", "weak"] })),
  });
  const b = linksOf(startBuild(sort, 2), ALL_RIGHT);
  b.placed = PARTS.map((p, i) => ({
    part: p.id,
    x: 0,
    y: 0,
    ...(i < 2 ? { slot: "against" } : {}),
  }));
  const loose = grade(sort, b);
  assert.equal(loose.pass, false, "five explanations in no column");
  assert.equal(loose.loose, 5);
  for (const p of b.placed) p.slot ??= "against";
  const sorted = grade(sort, b);
  assert.equal(sorted.pass, true, "every part sorted, if not as Claude has it");
  assert.ok(sorted.slots.some((x) => !x.ok));
  // a part the model gives no slot never stops a pass
  const half = model({
    frame: { kind: "lanes", lanes: ["Blood", "Lymph node"] },
    parts: PARTS.map((p, i) => (i ? { ...p, slot: "Blood" } : p)),
  });
  const hb = linksOf(startBuild(half, 1), ALL_RIGHT);
  assert.equal(hb.placed.find((x) => x.part === "virus")?.slot, undefined);
  assert.equal(grade(half, hb).pass, true);
});

test("pass: a link you argued for and Claude accepted counts toward the other links a pass needs", () => {
  const m = model();
  const b = linksOf(startBuild(m, 2), [
    ...KEYS_RIGHT,
    ["virus", "dendritic", "picked up by"],
    ["dendritic", "helpert", "shows to"],
    ["helpert", "plasma", "activates"],
  ]);
  assert.equal(grade(m, b).pass, false, "2 of the 3 others");
  m.links.push({
    id: "a7",
    from: "helpert",
    to: "plasma",
    rel: "activates",
    key: false,
    argued: true,
  });
  const r = grade(m, b);
  assert.deepEqual([r.rest, r.restGot, r.restNeed], [4, 3, 3]);
  assert.equal(r.pass, true);
});

test("review: a rebuild is graded on its key links only, and one left open on day 1 is logged as day 1's", () => {
  const { s } = buildMap();
  const m = s.models["m-s1"];
  for (const i of newItems(m, noon(0))) s.items[i.id] = i;
  s.review = { at: noon(1), since: 1, order: ["s1"], items: 3, cards: [] };
  s.steps.s1 = {
    stage: "build",
    help: 1,
    reviewing: true,
    rungs: freshRungs(),
  };
  const b = linksOf(startBuild(m, 1), KEYS_RIGHT);
  assert.equal(keyOnlyFor(b, s.steps.s1), true);
  b.last = grade(m, b, { keyOnly: keyOnlyFor(b, s.steps.s1), now: noon(1) });
  assert.equal(b.last.pass, true, "the key links pass a review");
  b.checks = 1;
  b.first = { l3: true, l4: true, l6: true };
  s.builds[m.id] = b;
  // ended on day 16: logged on day 1, so it moved a box then and is due again
  endReview(s, noon(16));
  const item = s.items[`${m.id}:l3`];
  assert.equal(item.log.at(-1)?.at, noon(1));
  assert.equal(item.box, 2);
  assert.ok(item.due <= noon(16));
  assert.deepEqual(s.visits, [{ at: noon(1), unaided: 3, of: 3 }]);
});

test("hints: an order wrong on an axis gets a hint and a part shown in its place", () => {
  const ticks = ["1", "2", "3"];
  const axis = model({
    mode: "play",
    frame: { kind: "axis", ticks },
    parts: PARTS.slice(0, 3).map((p, i) => ({ ...p, slot: ticks[i] })),
    links: [
      KEY("p1", "virus", "dendritic", "then"),
      KEY("p2", "dendritic", "helpert", "then"),
      { id: "p3", from: "helpert", to: "virus", rel: "then" },
    ],
  });
  const b = linksOf(startBuild(axis, 1), [
    ["virus", "dendritic", "then"],
    ["dendritic", "helpert", "then"],
    ["helpert", "virus", "then"],
  ]);
  b.placed = ["dendritic", "virus", "helpert"].map((part, i) => ({
    part,
    x: 0,
    y: 0,
    slot: ticks[i],
  }));
  b.checks = 1;
  assert.equal(grade(axis, b).pass, false);
  const h = nextHint(axis, b);
  assert.deepEqual(h, { link: "place:virus", rung: 1 });
  b.hints.push(h as Build["hints"][number]);
  assert.match(nextHint(axis, b) as string, /Show one place/);
  const shown = showOneLink(axis, b);
  assert.deepEqual(shown, { part: "virus" });
  assert.equal(b.placed.find((p) => p.part === "virus")?.slot, "1");
  assert.equal(creditOf(b), "shown");
});

test("hints: where names the end you have not linked yet", () => {
  const m = model();
  // the key link "Helper T cell activates B cell": you linked Helper T cell elsewhere
  const b = linksOf(startBuild(m, 2), [["helpert", "plasma", "activates"]]);
  b.checks = 1;
  assert.deepEqual(nextHint(m, b), { link: "l3", rung: 1, end: "to" });
  const fresh = startBuild(m, 2);
  fresh.checks = 1;
  assert.deepEqual(nextHint(m, fresh), { link: "l3", rung: 1 });
});

test("giveaway: a play step's summary that lists its subgoals in order is cut", () => {
  const ticks = ["1", "2", "3", "4"];
  const m = model({
    mode: "play",
    frame: { kind: "axis", ticks },
    parts: [
      { id: "check", label: "Check window open", role: "", slot: "1" },
      { id: "pick", label: "Pick the middle", role: "", slot: "2" },
      { id: "compare", label: "Compare with target", role: "", slot: "3" },
      { id: "shrink", label: "Shrink the window", role: "", slot: "4" },
    ],
    links: [],
  });
  const summary = "Play one round: pick a middle, compare, shrink the window";
  assert.equal(tellsOrder(m, summary), true);
  assert.equal(tellsOrder(m, "shrink the window, then pick a middle"), false);
  assert.equal(
    scrub(m, { title: "One round", summary }).summary,
    "Play one round",
  );
});

test("view: a frame label that says the predict's answer, or a part's name at L3, goes out by its number", () => {
  const lanes = ["Right heart side", "Lungs", "Left heart side", "Body"];
  const parts = [
    { id: "rheart", label: "Right heart", role: "pumps", slot: lanes[0] },
    { id: "lcap", label: "Lung capillaries", role: "swap gas", slot: lanes[1] },
    { id: "lheart", label: "Left heart", role: "pumps", slot: lanes[2] },
    { id: "aorta", label: "Aorta", role: "out", slot: lanes[3] },
  ];
  const { m: map, s } = buildMap("new");
  const m = model({
    id: "m-s1",
    frame: { kind: "lanes", lanes },
    parts,
    links: [
      KEY("c1", "rheart", "lcap", "sends to"),
      KEY("c2", "lcap", "lheart", "sends to"),
      { id: "c3", from: "lheart", to: "aorta", rel: "sends to" },
    ],
  });
  m.predict = {
    ask: "Where does it go after the lungs?",
    choices: [{ text: "Back to the left side of the heart" }, { text: "Body" }],
    answer: "Back to the left side of the heart",
    hides: "c2",
  };
  s.models["m-s1"] = m;
  s.steps.s1 = { stage: "see", help: 0, rungs: freshRungs() };
  const see = viewOf(s, map.nodes, 0).steps[0];
  assert.equal(see.frame.kind, "lanes");
  const shown = (see.frame as { lanes: string[] }).lanes;
  assert.equal(shown[2], "Lane 3", "the hidden part's own lane");
  assert.ok(!JSON.stringify(see).includes("Left heart side"));
  // at L3 a lane that spells a part's name is a number; "Lungs" stays
  s.steps.s1 = { stage: "build", help: 3, rungs: freshRungs() };
  s.builds["m-s1"] = startBuild(m, 3);
  const l3 = viewOf(s, map.nodes, 0).steps[0];
  assert.deepEqual((l3.frame as { lanes: string[] }).lanes, [
    "Lane 1",
    "Lungs",
    "Lane 3",
    "Body",
  ]);
  // and the server takes the number back
  assert.equal(slotFrom(m.frame, "Lane 3"), "Left heart side");
  assert.equal(slotFrom(m.frame, "Lungs"), "Lungs");
});

test("outline: the current step is the one the move is about", () => {
  const { m: map, s } = buildMap("new");
  s.steps.s1 = { stage: "built", help: 0, rungs: freshRungs() };
  s.steps.s2 = { stage: "see", help: 0, rungs: freshRungs() };
  s.at = "s1";
  assert.equal(stepOf(map.nodes, "s2"), "s2");
  const text = outlineOf(s, map.nodes, { full: false, at: "s2" });
  assert.match(text, /CURRENT STEP \[s2\]/);
});

test("canvas: lanes start compact; a box holds every part it is given; the waiting zone is sized once", () => {
  const lanes = ["A", "B", "C", "D"];
  const m = model({
    frame: { kind: "lanes", lanes },
    parts: PARTS.map((p, i) => ({ ...p, slot: lanes[i % 4] })),
  });
  // laid by depth, four lanes ran four columns wide
  const b = startBuild(m, 0);
  assert.ok(Math.max(...b.placed.map((p) => p.x)) <= 16 + 260);
  // six parts in one box: each on a spot inside it
  const frame = { kind: "boxes" as const, boxes: [{ id: "x", label: "X" }] };
  const six = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    x: 50,
    y: 50 + i,
    slot: "x",
  }));
  const at = drawn(frame, six);
  const [box] = regions(frame, 6);
  for (const p of Object.values(at))
    assert.ok(p.y + NODE_H <= box.y + box.h && p.y >= box.y, JSON.stringify(p));
  assert.equal(new Set(Object.values(at).map((p) => `${p.x},${p.y}`)).size, 6);
  // the zone for parts outside the frame keeps its size as they arrive
  const z1 = looseZone(frame, 0, undefined, 8)!;
  const z8 = looseZone(frame, 0, undefined, 8)!;
  assert.deepEqual(z1, z8);
  const loose = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i}`,
    x: 0,
    y: 0,
  }));
  const lat = drawn(frame, loose, 8);
  for (const p of Object.values(lat))
    assert.ok(p.x + NODE_W <= z8.x + z8.w && p.y + NODE_H <= z8.y + z8.h);
});

test("canvas: an axis waits under its ticks, and a part taken out of the zone moves nothing else", () => {
  const ticks = ["t1", "t2", "t3", "t4", "t5", "t6"];
  const frame = { kind: "axis" as const, ticks };
  const parts = Array.from({ length: 7 }, (_, i) => ({
    id: `p${i}`,
    x: 0,
    y: 0,
  }));
  const zone = looseZone(frame, 0, undefined, 7)!;
  const cols = regions(frame, 0, 7);
  const right = Math.max(...cols.map((r) => r.x + r.w));
  // under the ticks, no wider than them: beside them, six ticks opened at 0.5
  assert.ok(zone.y >= Math.max(...cols.map((r) => r.y + r.h)));
  assert.ok(zone.x + zone.w <= right + 1, `${zone.x + zone.w} > ${right}`);
  assert.ok(right <= 6 * 190);
  const before = drawn(frame, parts, 7);
  // one dropped low in tick 3: the column does not grow, nothing else moves
  const after = drawn(
    frame,
    parts.map((p) => (p.id === "p2" ? { ...p, slot: "t3", y: 900 } : p)),
    7,
  );
  for (const p of parts)
    if (p.id !== "p2") assert.deepEqual(after[p.id], before[p.id], p.id);
  assert.deepEqual(
    looseZone(
      frame,
      spanOf(frame, [{ x: 0, y: 900, slot: "t3" }]),
      undefined,
      7,
    ),
    zone,
  );
  // and it sits in its column, at the top spot
  assert.ok(after.p2.y < cols[2].y + cols[2].h);
  assert.equal(slotAt(frame, after.p2, 0, 7), "t3");
  // a drop on the zone is not a drop in the column above it
  assert.equal(slotAt(frame, before.p2, 0, 7), null);
});

test("canvas: two links in a chain never put their labels on one spot", () => {
  // eight parts on the default grid, every chain of two links through them
  // ("causes ·s", with "activates" under it, on one channel)
  const at: Record<string, At> = {};
  for (let k = 0; k < 8; k++)
    at[`p${k}`] = { x: (k % 3) * (NODE_W + 48), y: Math.floor(k / 3) * 110 };
  const ids = Object.keys(at);
  for (const a of ids)
    for (const b of ids)
      for (const c of ids) {
        if (a === b || b === c || a === c) continue;
        const seen = nothingDrawn();
        const box = (x: string, y: string, l: string) => {
          const p = pathOf(at[x], at[y], route(x, y, at, l, 0, seen)).label;
          const w = labelWidth(l);
          return { x: p.x - w / 2, y: p.y - 9, w, h: 18 };
        };
        const p = box(a, b, "activates");
        const q = box(b, c, "causes");
        const hit =
          p.x < q.x + q.w &&
          p.x + p.w > q.x &&
          p.y < q.y + q.h &&
          p.y + p.h > q.y;
        assert.ok(!hit, `${a} → ${b} → ${c}`);
      }
});

test("canvas: a link keeps off the links drawn before it and never runs through a part, its own two included", () => {
  // five subgoals on an axis, one per tick, and a link back from the last
  const at: Record<string, At> = Object.fromEntries(
    ["a", "b", "c", "d", "e"].map((id, i) => [id, { x: i * 200 + 8, y: 8 }]),
  );
  const seen = nothingDrawn();
  const ids = ["ab", "bc", "cd", "de", "ea"];
  const lines = ids.map((k) => {
    const r = route(k[0], k[1], at, "then", 0, seen);
    return pathOf(at[k[0]], at[k[1]], r).pts;
  });
  // the long way back does not run along any forward link
  const back = lines[4];
  const flat = (pts: At[]) =>
    pts.slice(1).flatMap((q, i) => (q.y === pts[i].y ? [q.y] : []));
  for (const fwd of lines.slice(0, 4))
    for (const y of flat(back)) assert.ok(!flat(fwd).includes(y), `${y}`);
  // a part right under its source: the link does not come back down through it
  const stack = {
    lv: { x: 0, y: 0 },
    ao: { x: 0, y: 130 },
    x: { x: 260, y: 0 },
  };
  const r = route("lv", "ao", stack, "sends to");
  assert.equal(blocked("lv", "ao", stack, r, "sends to"), false);
  const { pts } = pathOf(stack.lv, stack.ao, r);
  const inside = (p: At) =>
    p.x > 2 && p.x < NODE_W - 2 && p.y > 2 && p.y < NODE_H - 2;
  assert.ok(!pts.some(inside));
});

test("the mode does not switch while a move runs: the next click could land on a paid button", async () => {
  const { m } = buildMap("new");
  const { engine, calls } = setup(m);
  const run = act(engine, {
    type: "message",
    text: "What is a B cell?",
    selection: [],
  } as Parameters<typeof act>[1]);
  await settled(calls, 1);
  const r = await act(engine, {
    type: "purpose",
    purpose: "explore",
  } as Parameters<typeof act>[1]);
  assert.match(r.error ?? "", /switch once it is done/);
  assert.equal(m.purpose, "learn");
  calls[0].release(reply([]));
  await run;
  assert.deepEqual(
    await act(engine, {
      type: "purpose",
      purpose: "explore",
    } as Parameters<typeof act>[1]),
    {},
  );
  assert.equal(m.purpose, "explore");
});
