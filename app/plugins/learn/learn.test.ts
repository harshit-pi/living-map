// Learn as a plugin: registered, its classic prompts pinned word for word,
// and build mode's pure logic (cleaning, grading, fading, the schedule, the
// view) and its moves on the engine with a scripted model. The fixture is the
// text core sent before Learn was a plugin; a change to the classic prompts
// is a deliberate change to this fixture.

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import { BUILD_ACTIONS } from "./build.ts";
import {
  addLinks,
  addMiscon,
  caseShape,
  cleanModel,
  DAY,
  dueOf,
  givesAway,
  grade,
  helpFor,
  kept,
  localDay,
  markRecall,
  matchPart,
  mixedOrder,
  newItems,
  newState,
  record,
  scrub,
  setPredict,
  setWhatIf,
  startBuild,
  validate,
  viewOf,
  whatIf,
  whyPrecheck,
  type Build,
  type LearnState,
  type RefModel,
} from "./core.ts";
import fixture from "./prompts.fixture.json" with { type: "json" };
import { learn } from "./server.ts";
import type { Verb } from "./shared.ts";
import { act } from "../../server/actions/index.ts";
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
      "role",
      (m) => (m.parts[0].role = "caught by the Dendritic cell"),
      /role of "Flu virus" names another part, "Dendritic cell"/,
    ],
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

test("grade: lanes and sort slots (a list of fair slots), and pairs out of order on an axis", () => {
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
  assert.deepEqual(grade(lanes, b).slots, [
    { part: "virus", ok: true },
    { part: "bcell", ok: false },
    { part: "memb", ok: false },
  ]);
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
  // with no slots, the order is read from left to right
  ab.placed = ab.placed.map((p, i) => ({
    part: p.part,
    x: 300 - i * 100,
    y: 0,
  }));
  assert.equal(grade(axis, ab).outOfOrder, 6);
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
    l1.placed.every((p) => !p.slot && [0, 220, 440].includes(p.x)),
    "a plain grid",
  );
  assert.notDeepEqual(
    l1.placed.map((p) => p.part),
    m.parts.map((p) => p.id),
    "in a shuffled order, not the worked layout",
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
  assert.equal(near.suggest.length, 3);
  assert.equal(near.suggest[0], "Plasma cell", "the closest first");
});

test("what-if: found, missed and extra", () => {
  assert.deepEqual(whatIf(model(), ["bcell", "antibody", "virus", "nope"]), {
    found: ["bcell", "antibody"],
    missed: 1,
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
  const fresh = model({
    case: "a measles vaccine, then an outbreak ten years on",
    parts: PARTS.map((p) => ({ ...p, label: `New ${p.label.split(" ")[0]}x` })),
  });
  assert.deepEqual(caseShape(orig, fresh), []);
  const otherVerbs = model({
    case: "a measles vaccine",
    parts: fresh.parts,
    links: LINKS.map((l) => (l.id === "l4" ? { ...l, rel: "sends to" } : l)),
  });
  assert.match(caseShape(orig, otherVerbs).join(), /same kinds of verb/);
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
  assert.deepEqual(dueOf(s, live, noon(1)), { now: 4, next: null });
  assert.deepEqual(
    dueOf(s, new Set(["s2"]), noon(1)),
    { now: 0, next: null },
    "a dropped step's items wait",
  );
  const items = Object.values(s.items);
  assert.equal(helpFor(items), 1);
  for (const i of items) i.box = 2;
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
  assert.equal(see.worked.parts.find((p) => p.id === "memb")?.label, "?");
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
  assert.equal(from.hidden, "bcell");
  assert.equal(from.parts.find((p) => p.id === "bcell")?.label, "?");
  assert.equal(from.parts.find((p) => p.id === "memb")?.label, "Memory B cell");
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
  calls[1].release(reply(MODEL_OPS("s2", "m1")));
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
    4,
    "three key links and the what-if",
  );
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
  assert.equal(view().whatif?.result?.missed, 0);
  assert.equal(calls.length, 3);

  // a day later the items are due, and the review opens at the help they earned
  vi.setSystemTime(noon(1));
  assert.equal(learn.due!(m, Date.now()).now, 4);
  assert.match(learn.summary!(m), /1 of 3 built · 4 due/);
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
  assert.deepEqual(await act(engine, learnAct("done")), { ok: true });
  assert.deepEqual(s.visits.at(-1), { at: noon(1), unaided: 3, of: 3 });
  assert.match(learn.summary!(m), /last review 3 of 3 unaided/);
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
  assert.ok(v.steps[0].problems.length);
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
  const argued = act(
    engine,
    learnAct("argue", {
      step: "s1",
      link: b.links[0].id,
      text: "Helper T cells signal plasma cells too.",
    }),
  );
  await settled(calls, 1);
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
  await act(engine, learnAct("check", { step: "s1" }));
  assert.equal(b.last?.marks[0].mark, "right");
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
