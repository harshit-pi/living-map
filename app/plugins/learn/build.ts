// Learn's build mode on the server: what Claude is told, the ops it writes
// (a model per step, its links, misconceptions, predict and what-if, and the
// verdicts on a Why or an argued link), and the actions the screen sends.
// Every check of your build is core.ts, with no model call; Claude is asked
// only to write a model, judge a Why, write a new case or weigh an argued
// link. The reference never reaches the browser (view in core.ts).

import {
  addLinks,
  addMiscon,
  caseShape,
  cleanModel,
  creditOf,
  freshStep,
  grade,
  helpFor,
  ideaCards,
  itemsOf,
  linkParts,
  linkWords,
  localDay,
  markRecall,
  matchPart,
  mixedOrder,
  movePart,
  newItems,
  newState,
  nextHint,
  outcomes,
  pathSteps,
  peek,
  placePart,
  record,
  relinkParts,
  scrub,
  seedOf,
  setPredict,
  setWhatIf,
  showOneLink,
  startBuild,
  unaidedSince,
  unlinkParts,
  unplacePart,
  validate,
  whatIf,
  whyPrecheck,
  isSure,
  DAY,
  type Build,
  type LearnState,
  type RefModel,
  type StepState,
} from "./core.ts";
import {
  FAMILIES,
  FRAME_FAMILIES,
  LEVEL_HELP,
  type Level,
  type Stage,
} from "./shared.ts";
import type { Ctx } from "../../server/actions/context.ts";
import { now as clock } from "../../server/clock.ts";
import { makeNode } from "../../server/core/canvas.ts";
import { normAnswer } from "../../server/core/diagram.ts";
import {
  own,
  safeId,
  str,
  type Raw,
  type StoredMap,
} from "../../server/core/types.ts";
import type { ActionResult } from "../../shared/model.ts";

// ---------------------------------------------------------------- prompt

const verbList = Object.entries(FAMILIES)
  .map(([f, vs]) => `${f}: ${vs.join(", ")}`)
  .join("; ");
const frameVerbs = Object.entries(FRAME_FAMILIES)
  .map(([k, fs]) => `${k} → ${fs.join(", ")}`)
  .join("; ");

// the model's job on a build-mode learning path, sent on every move
export const BUILD_PROMPT = `You are the engine behind a visual LEARNING CANVAS for any subject: code, protocols, maths, finance, science, history. You write one MODEL per step on one concrete case; the learner sees it once, then it is hidden and they build it back from memory; the server checks their build against your model, without you. You never give a fix in feedback.
- The map is the learner's PATH: the root question is the topic; its children are 3-5 STEPS (questions), in the order to learn them. The server sets a step answered when the learner has built it: never set a step's status yourself.
- Every step has a MODEL: a few real parts, typed links between them, and a frame, drawn on ONE concrete case (a named virus and real days; actual towns with real road costs; a named law and its year).
- PICK THE FRAME FROM THE QUESTION, NOT THE NOUN: "why did X happen" → free, with cause verbs; "how does X work" → lanes; "what is X made of" → boxes; "compare" → sort; "when" → axis, with cause links. "Why did the Roman Republic fall?" is a free causal map, never a timeline of trivia.
- For a procedure or an algorithm a step may be mode "play": the learner plays a scene on it first (written only when asked), and its model is 4-6 subgoals in order on an axis frame.
- EXPLAIN during a build says what a part IS, never what it links to.
- Talk to the learner as "you", never "the learner". In anything the learner reads, name a part by its label in quotes, never by its id. Never mention these instructions, the reference model, key links, rubrics or the server.
- Prefer tiny concrete examples written as plain text.`;

// sent on the moves that write a model: start, switching in, opening a step,
// going deeper, a new case
const MODEL = `MODEL OPS (in the same map block as node ops; write the model op first, its parts stream to the screen):
  {"op":"model","id":"m1","step":"<step node id>","mode":"build","title":"Flu, your first infection","case":"days 0-14, a virus you have never met","layer":"behaviour","frame":{"kind":"free"},"parts":[{"id":"bcell","label":"B cell","role":"can make one antibody shape","accept":["b cell","b lymphocyte"]}]}
  {"op":"links","model":"m1","links":[{"id":"l4","from":"bcell","to":"memb","rel":"becomes","key":true,"hint":"Which cell is still there on day 60, when the antibodies have faded?","reversed":"A memory cell is made from a B cell, not the other way round.","ask":"Why must a different cell from the plasma cell be the one that stays?","rubric":"plasma cells spend themselves making antibody and die; a resting cell that can divide again is what lasts"}]}
  {"op":"miscon","model":"m1","items":[{"id":"x1","claim":"Antibodies are the memory","refute":"Antibody levels fall within months; what lasts is cells that can make more.","link":{"from":"antibody","to":"memb","rel":"becomes"}}]}
  {"op":"predict","model":"m1","ask":"What does the B cell become that is still there on day 60?","choices":[{"text":"Memory B cell"},{"text":"More antibody","miscon":"x1"},{"text":"Plasma cell"}],"answer":"Memory B cell","hides":"l4"}
  {"op":"whatif","model":"m1","fails":"helpert","ask":"Your helper T cells are wiped out, as in HIV. Which parts stop working on a second infection?","affected":["bcell","plasma","antibody"],"why":"B cells need a helper T signal before they multiply."}
FRAMES: {"kind":"free"} | {"kind":"lanes","lanes":["…"]} (each part has a "slot": its lane) | {"kind":"axis","ticks":["…"]} (order matters; each part's "slot" is its tick) | {"kind":"boxes","boxes":[{"id":"…","label":"…"}]} (each part's "slot" is the box it sits in) | {"kind":"sort","columns":["strong evidence","weak","against"]} (a part's "slot" may be a list when more than one column is fair).
VERBS ("rel"), by family: ${verbList}. Each frame takes only some families: ${frameVerbs}.
LAYERS ("layer"): parts · behaviour · function · failure. For a system, the first step is its parts and what each is for, the next how they interact; the why questions are its function and the what-if is its failure.
RULES: 4-8 parts; 3-10 links; 2-3 links with "key":true, which are the ideas the step is about, each with a "hint", an "ask" and a "rubric". Labels of 4 words or fewer. A role of 12 words or fewer that never names another part. At most 3 misconceptions, real ones learners hold, never made up; give one a "link" when it is a wrong link people draw. A hint is a question and never names both ends of its link. The predict question's answer is not in the step's title or summary, and "hides" names the key link it is about. The case is concrete: a named thing, real numbers. In contested history, a sort-frame step weighs the explanations against the evidence.`;

const WHY = `WHY on a key link: judge the learner's answer against that link's rubric (in the outline). The words do not have to match; the idea does. Write one op: {"op":"why","model":"<model id>","link":"<link id>","state":"right|partial|wrong","say":"at most 30 words"}. If partial or wrong, "say" asks ONE question that leads them on, never the fix. The caption is one short sentence.`;

const CASE = `NEW CASE for a step: write a new model of the same idea on a case that looks different: a model op with "of":"<the original model id>" and the same "step", then its own links, miscon and whatif ops (no predict). The same key links on a case that looks different: change the shape of the problem, not just the numbers. Different part labels, the same kinds of verb on the key links.`;

const ARGUE = `ARGUE for a link: the learner drew a link that is not in your model and says why it holds. Say whether it holds IN THIS CASE, with one op: {"op":"accept","model":"<model id>","link":{"from":"…","to":"…","rel":"…"},"holds":true|false,"say":"one line"}. Be generous when it is true but simply not in your model; say no only when it is false here.`;

const LAYER = `GOING DEEPER on a part: the new step's model is inside that part, in this order of cases: one concrete case inside the part, then a varied case, the general rule, and where it breaks. For a part of a system: its own parts, how they interact, what breaks.`;

export const BUILD_SECTIONS: Record<string, string> = {
  model: MODEL,
  why: WHY,
  case: CASE,
  argue: ARGUE,
  layer: LAYER,
};

export const buildStartAction = (title: string) =>
  `start. The learner wants to understand: "${title}". Create the root question (the topic, parent null) and 3-5 steps under it in learning order. Then write the MODEL of the FIRST step only (a model op whose "step" is that step's id, then its links, miscon, predict and whatif ops), on one concrete case. In the map block write the root and the steps first, then the model op, then its other ops. No topic diagram.`;

export const BUILD_ENTER_ACTION =
  'the canvas was switched to LEARN mode. Keep the root; under it make 3-5 step questions in learning order, then write the MODEL of the FIRST step (a model op whose "step" is that step\'s id, then its links, miscon, predict and whatif ops). Remove nothing: every node already on the map stays where it is (the learner explored it, and it is listed under what they looked into); a useful existing question can be one of the steps, but keep its title and summary as they are (Explore reads them when the learner switches back): say what a step is in the caption, never by rewriting an existing node.';

// ---------------------------------------------------------------- ops

const LEARN_OPS = new Set([
  "model",
  "links",
  "miscon",
  "predict",
  "whatif",
  "why",
  "accept",
]);

const safe = (v: unknown): string => {
  const s = str(v, 60).trim();
  return safeId(s) ? s : "";
};

// a model by the id Claude gave it (the latest model it gave that id) or ours
const resolve = (s: LearnState, raw: unknown): RefModel | undefined => {
  const id = safe(raw);
  return own(s.models, own(s.alias, id) ?? id);
};

const unique = (s: LearnState, base: string): string => {
  const b = base.slice(0, 50);
  let id = b;
  for (let n = 2; own(s.models, id); n++) id = `${b}-${n}`;
  return id;
};

// A step's model is fixed once it is shown: a model op is taken only while
// the step has none that holds (still writing, or broken). A new case is
// taken only on a step that is built.
function applyModel(s: LearnState, map: StoredMap, op: Raw): number {
  const m = cleanModel(op);
  if (!m) return 0;
  const own_ = m.id;
  const node = own(map.nodes, m.step);
  if (node && !node.parent) return 0;
  if (m.of) {
    const orig = resolve(s, m.of);
    if (!orig || orig.status !== "ready" || orig.of) return 0;
    const st = own(s.steps, orig.step);
    if (!st || st.stage !== "built") return 0;
    m.of = orig.id;
    m.step = orig.step;
    const cur = st.caseModel ? own(s.models, st.caseModel) : undefined;
    m.id =
      cur && cur.status !== "ready" ? cur.id : unique(s, `${orig.id}-case`);
    st.caseModel = m.id;
    st.onCase = false;
  } else {
    const cur = own(s.models, own(s.stepModel, m.step) ?? "");
    if (cur?.status === "ready") return 0;
    m.id = cur?.id ?? unique(s, `m-${m.step}`);
    s.stepModel[m.step] = m.id;
  }
  s.alias[own_] = m.id;
  s.models[m.id] = m;
  return 1;
}

function applyWhy(s: LearnState, op: Raw): number {
  const m = resolve(s, op.model);
  const st = m && own(s.steps, m.step);
  if (!m || !st || st.stage !== "why" || !st.why) return 0;
  const link = safe(op.link);
  if (link && link !== st.whyLink) return 0;
  if (!["right", "partial", "wrong"].includes(op.state)) return 0;
  st.why.state = op.state;
  st.why.say = str(op.say, 240).trim();
  return 1;
}

function applyAccept(s: LearnState, op: Raw): number {
  const m = resolve(s, op.model);
  const b = m && own(s.builds, m.id);
  if (!m || !b?.argue) return 0;
  // the verdict is on the link you argued for, whatever ids the reply used
  const { from, to, rel } = b.argue;
  const holds = op.holds === true;
  if (
    holds &&
    !m.links.some((l) => l.from === from && l.to === to && l.rel === rel)
  )
    m.links.push({
      id: `a${m.links.length + 1}`,
      from,
      to,
      rel,
      key: false,
      argued: true,
    });
  (b.argued ??= []).push({
    from,
    to,
    rel,
    holds,
    say: str(op.say, 200).trim(),
  });
  delete b.argue;
  return 1;
}

export function applyBuildOp(
  map: StoredMap,
  op: Raw,
  scope: string | null,
): number | null {
  if (!LEARN_OPS.has(op?.op)) return null;
  const s = peek(map.data);
  // a side thread may not rewrite a model or give a verdict; a classic map has none
  if (!s || s.mode !== "build" || scope) return 0;
  switch (op.op) {
    case "model":
      return applyModel(s, map, op);
    case "why":
      return applyWhy(s, op);
    case "accept":
      return applyAccept(s, op);
  }
  const m = resolve(s, op.model);
  if (!m || m.status === "ready") return 0;
  if (op.op === "links") return addLinks(m, op.links);
  if (op.op === "miscon") return addMiscon(m, op.items);
  if (op.op === "predict") return setPredict(m, op) ? 1 : 0;
  return setWhatIf(m, op) ? 1 : 0;
}

// ---------------------------------------------------------------- helpers

const WRITING = "Drawing this step";
const JUDGING = "Reading your why";
const NEW_CASE = "Writing a new case";

const id = (v: unknown): string =>
  typeof v === "string" && safeId(v) ? v : "";

const state = (map: StoredMap): LearnState | null => {
  const s = peek(map.data);
  return s?.mode === "build" ? s : null;
};

const ok = (ctx: Ctx, result = true): ActionResult => {
  ctx.engine.push();
  return { ok: result };
};

const topPath = (map: StoredMap) =>
  pathSteps(map.nodes)
    .filter((p) => p.depth === 0)
    .map((p) => p.id);

type At = {
  s: LearnState;
  step: string;
  st: StepState;
  main: RefModel;
  // the model being built now: the step's own, or its new case
  m: RefModel;
};

// The step an action is about, its state and its model, or why not.
function at(ctx: Ctx, a: Raw, stages?: Stage[]): At | string {
  const s = state(ctx.map);
  if (!s) return "This map is not practised as builds.";
  const step = id(a?.step ?? a?.nodeId);
  if (!pathSteps(ctx.map.nodes).some((p) => p.id === step))
    return "No such step.";
  s.at = step;
  const st = (s.steps[step] ??= freshStep(s.level));
  const main = own(s.models, own(s.stepModel, step) ?? "");
  if (main?.status !== "ready") return "This step's model is not ready.";
  const c = st.caseModel ? own(s.models, st.caseModel) : undefined;
  const m = st.onCase && c?.status === "ready" ? c : main;
  if (stages && !stages.includes(st.stage))
    return st.stage === "see"
      ? "Hide the worked case first."
      : st.stage === "built"
        ? "This step is already built."
        : "Not at this point of the step.";
  return { s, step, st, main, m };
}

const buildOf = (x: At): Build =>
  (x.s.builds[x.m.id] ??= startBuild(x.m, x.st.help));

const fresh = (x: At, help = x.st.help) => {
  x.st.help = help;
  x.s.builds[x.m.id] = startBuild(x.m, help);
};

// Settle a model that has just been written: problems if it does not hold
// together; otherwise its giveaways are scrubbed and it is shown.
function settle(ctx: Ctx, s: LearnState, m: RefModel | undefined): string[] {
  if (!m) return ["no model op arrived for this step"];
  if (m.status === "ready") return [];
  const node = own(ctx.map.nodes, m.step);
  const step = node ? { title: node.title, summary: node.summary } : undefined;
  const orig = m.of ? own(s.models, m.of) : undefined;
  const problems = [...validate(m, step), ...(orig ? caseShape(orig, m) : [])];
  if (problems.length) {
    m.problems = problems;
    return problems;
  }
  const cut = scrub(m, step ?? { title: "", summary: "" });
  if (node && cut.summary !== null) node.summary = cut.summary;
  m.status = "ready";
  delete m.problems;
  s.steps[m.step] ??= freshStep(s.level);
  return [];
}

// One move that writes a model, checked when it lands. A model that does not
// hold together is asked for once more, naming its problems (as withDetail
// does); if that fails too the step says so and offers Try again. The second
// try runs after this move resolves, so what arrived shows at once.
async function writeModel(
  ctx: Ctx,
  opts: {
    action: string;
    label: string;
    nodeId?: string;
    sections: string[];
    keep?: boolean;
    // the model this move should have written, once it has landed
    target: () => RefModel | undefined;
    // the step, once it is known (the first move lays the path out)
    step: () => string | null;
    // a new case is placed on its step once it holds
    onReady?: (m: RefModel) => void;
  },
): Promise<ActionResult> {
  const s = state(ctx.map);
  if (!s) return { error: "This map is not practised as builds." };
  const r = await ctx.engine.turn(opts.action, ctx.settings, {
    label: opts.label,
    nodeId: opts.nodeId,
    sections: opts.sections,
    keep: opts.keep,
  });
  if (r.error || r.stopped) return r;
  const step = opts.step();
  if (!step) return r;
  const first = settle(ctx, s, opts.target());
  if (!first.length) {
    opts.onReady?.(opts.target()!);
    ctx.engine.push();
    return r;
  }
  void ctx.engine
    .turn(
      `${opts.action} Your previous reply did not hold together: ${first.join("; ")}. Send the model op for step "${step}" again, whole, with all its other ops.`,
      ctx.settings,
      {
        label: `${opts.label} (second try)`,
        nodeId: opts.nodeId ?? step,
        sections: opts.sections,
        keep: opts.keep,
      },
    )
    .then((r2) => {
      const m = opts.target();
      const again = r2.error || r2.stopped ? ["stopped"] : settle(ctx, s, m);
      if (again.length) {
        if (m) m.status = "broken";
        else ctx.note(`No model arrived for step "${step}".`);
      } else opts.onReady?.(m!);
      ctx.engine.push();
    });
  return r;
}

const modelOf = (s: LearnState, step: string) =>
  own(s.models, own(s.stepModel, step) ?? "");

// What to ask for when a step's model is written on opening it: a "Go
// deeper" step uses the layer template; a step of a map learned before with
// the topic diagram builds on it.
function openAction(
  ctx: Ctx,
  step: string,
): { action: string; sections: string[] } {
  const node = ctx.map.nodes[step];
  const parent = node.parent ? own(ctx.map.nodes, node.parent) : undefined;
  const deep = !!parent?.parent;
  const named = `[${step}] "${node.title}"`;
  const topic = ctx.map.diagram
    ? ` This map was learned first with the TOPIC DIAGRAM below, and this step is ${node.status === "answered" ? "already worked out" : "still open"}: draw the model on the same case where it fits.`
    : "";
  return {
    action: deep
      ? `MODEL for step ${named}, inside a part of step [${parent!.id}] "${parent!.title}": write its model (op "model", step "${step}") and its links, miscon, predict and whatif ops, following GOING DEEPER.${topic} Nothing else in the block.`
      : `MODEL for step ${named}: write its model (op "model", step "${step}") and its links, miscon, predict and whatif ops, on one concrete case.${topic} Nothing else in the block.`,
    sections: deep ? ["model", "layer"] : ["model"],
  };
}

function writeStep(
  ctx: Ctx,
  s: LearnState,
  step: string,
): Promise<ActionResult> {
  const { action, sections } = openAction(ctx, step);
  return writeModel(ctx, {
    action,
    label: WRITING,
    nodeId: step,
    sections,
    target: () => modelOf(s, step),
    step: () => step,
  });
}

// The next step's model is written once the step before reaches Build, so it
// is ready when you get there.
function prefetch(ctx: Ctx, s: LearnState, step: string) {
  const path = topPath(ctx.map);
  const next = path[path.indexOf(step) + 1];
  if (!next || modelOf(s, next) || ctx.engine.isQueuedOrRunning(next, WRITING))
    return;
  void writeStep(ctx, s, next);
}

// ---------------------------------------------------------------- built, passed

function built(ctx: Ctx, x: At) {
  const { s, st, main, step } = x;
  const node = ctx.map.nodes[step];
  st.stage = "built";
  st.rungs.why ??=
    st.why?.state === "shown" ? "shown" : st.why?.tries === 1 ? "you" : "hints";
  if (node.kind === "question") {
    node.status = "answered";
    if (st.viaModel || st.why?.state === "shown") node.revealed = true;
  }
  if (!itemsOf(s, main.id).length)
    for (const i of newItems(main, clock())) s.items[i.id] = i;
  markRecall(s, topPath(ctx.map), step);
  ctx.note(
    `Built step "${node.title}"${st.why?.state === "shown" ? " (the why was shown)" : ""}.`,
  );
}

// a review or a quick rebuild writes its answers onto the step's items
function logBuild(x: At, b: Build) {
  const t = clock();
  for (const [link, o] of Object.entries(outcomes(x.main, b))) {
    const item = own(x.s.items, `${x.main.id}:${link}`);
    if (item) record(item, o.how, t, o.sure);
  }
}

const whyLinkOf = (m: RefModel, turn: number) => {
  const keys = m.links.filter((l) => l.key && !l.argued && l.ask);
  return keys.length ? keys[turn % keys.length].id : undefined;
};

function passed(x: At, b: Build) {
  const { st, s } = x;
  if (st.onCase) {
    st.rungs.case ??= creditOf(x.m, b);
    st.onCase = false;
    st.stage = "built";
    return;
  }
  if (st.recall) {
    logBuild(x, b);
    // it came out wrong when the first check did not pass
    st.recallWrong = b.checks > 1;
    st.recall = false;
    st.recallDone = true;
    st.stage = "built";
    return;
  }
  if (st.reviewing) {
    logBuild(x, b);
    st.reviewing = false;
    // a Why comes back only when the last one was partial or shown
    if (st.why?.state === "partial" || st.why?.state === "shown") {
      st.stage = "why";
      st.whyLink = whyLinkOf(x.main, s.visits.length + 1) ?? st.whyLink;
      st.why = { state: st.why.state, tries: 0 };
    } else st.stage = "built";
    return;
  }
  st.rungs.built = creditOf(x.main, b, st.viaModel);
  st.stage = "why";
  st.whyLink = whyLinkOf(x.main, s.visits.length);
  delete st.why;
  delete st.pre;
}

// ---------------------------------------------------------------- actions

type Act = (ctx: Ctx, a: Raw) => Promise<ActionResult> | ActionResult;
const fail = (x: At | string): x is string => typeof x === "string";
const err = (error: string): ActionResult => ({ error });

export async function startBuildMap(ctx: Ctx): Promise<ActionResult> {
  const m = ctx.map;
  m.data = { ...m.data, learn: newState("build") };
  const s = state(m)!;
  const first = () => topPath(m)[0] ?? null;
  const r = await writeModel(ctx, {
    action: buildStartAction(m.title),
    label: "Drawing your path and step 1",
    sections: ["model"],
    target: () => (first() ? modelOf(s, first()!) : undefined),
    step: first,
  });
  if (!r.error && !r.stopped && !Object.keys(m.nodes).length)
    return {
      error:
        "Claude did not lay anything out. Try again, or rephrase the question.",
    };
  return r;
}

// Switched in from Explore: a map that was never in Learn gets its path and
// step 1's model; one that was (its builds, or an older topic diagram) is
// left as it is, with no call.
export function enterBuild(ctx: Ctx): Promise<ActionResult> | ActionResult {
  const m = ctx.map;
  if (peek(m.data) || m.diagram || ctx.engine.state.busy) return {};
  m.data = { ...m.data, learn: newState("build") };
  const s = state(m)!;
  const first = () => topPath(m)[0] ?? null;
  return writeModel(ctx, {
    action: BUILD_ENTER_ACTION,
    label: "Turning this into a learning path",
    sections: ["model"],
    // what you explored stays, with its threads, for when you switch back
    keep: true,
    target: () => (first() ? modelOf(s, first()!) : undefined),
    step: first,
  });
}

// A map learned with the topic diagram, practised as builds from now on. The
// diagram, its fills and answers stay where they are; each step's model is
// written when you first open it. Steps you worked out already start at L1
// with no See; the rest start at the level chooser.
export function practise(ctx: Ctx): ActionResult {
  if (peek(ctx.map.data)?.mode === "build") return { ok: true };
  const s = newState("build");
  for (const p of pathSteps(ctx.map.nodes))
    if (ctx.map.nodes[p.id].status === "answered")
      s.steps[p.id] = { ...freshStep("some"), help: 1 };
  ctx.map.data = { ...ctx.map.data, learn: s };
  ctx.note("The learner practises this map as builds from now on.");
  return ok(ctx);
}

const level: Act = (ctx, a) => {
  const s = state(ctx.map);
  if (!s) return err("This map is not practised as builds.");
  const lv = a?.level as Level;
  if (!Object.hasOwn(LEVEL_HELP, lv)) return err("Pick one of the levels.");
  s.level = lv;
  // steps not started yet take the new level; nothing you did is undone
  for (const p of pathSteps(ctx.map.nodes)) {
    const st = own(s.steps, p.id);
    const m = modelOf(s, p.id);
    const started =
      ctx.map.nodes[p.id].status === "answered" ||
      (st &&
        (st.predicted ||
          st.stage === "why" ||
          st.stage === "built" ||
          (m && own(s.builds, m.id))));
    if (!started)
      s.steps[p.id] = {
        ...freshStep(lv),
        rungs: st?.rungs ?? freshStep(lv).rungs,
      };
  }
  const first = topPath(ctx.map)[0];
  if (first && lv !== "new" && modelOf(s, first)?.status === "ready")
    prefetch(ctx, s, first);
  return ok(ctx);
};

const open: Act = (ctx, a) => {
  const s = state(ctx.map);
  if (!s) return err("This map is not practised as builds.");
  const step = id(a?.step ?? a?.nodeId);
  if (!pathSteps(ctx.map.nodes).some((p) => p.id === step))
    return err("No such step.");
  s.at = step;
  s.steps[step] ??= freshStep(s.level);
  const m = modelOf(s, step);
  if (m?.status === "ready") {
    if (s.steps[step].stage === "build") prefetch(ctx, s, step);
    return ok(ctx);
  }
  if (ctx.engine.isQueuedOrRunning(step, WRITING)) return {};
  return writeStep(ctx, s, step);
};

const predict: Act = (ctx, a) => {
  const x = at(ctx, a, ["see"]);
  if (fail(x)) return err(x);
  const p = x.main.predict;
  if (!p) return err("This step has no question to predict.");
  const pick = p.choices.find((c) => c.text === a?.pick)?.text;
  if (!pick) return err("Pick one of the answers.");
  if (!isSure(a?.sure)) return err("Say how sure you are.");
  x.st.predicted ??= { pick, sure: a.sure };
  // right or wrong at once; a wrong pick's misconception is in the view
  return ok(ctx, normAnswer(x.st.predicted.pick) === normAnswer(p.answer));
};

const hide: Act = (ctx, a) => {
  const x = at(ctx, a, ["see"]);
  if (fail(x)) return err(x);
  if (x.main.predict && !x.st.predicted && !x.st.shownModel && !x.st.onCase)
    return err("Pick an answer first.");
  x.st.stage = "build";
  if (x.st.shownModel) {
    // after Show the model, the rebuild is at once, at L1, and it is shown
    x.st.shownModel = false;
    if (!x.st.reviewing && !x.st.recall && !x.st.rungs.built)
      x.st.viaModel = true;
    fresh(x, 1);
    buildOf(x).shown = x.m.links
      .filter((l) => l.key && !l.argued)
      .map((l) => l.id);
  } else fresh(x);
  prefetch(ctx, x.s, x.step);
  return ok(ctx);
};

const showModel: Act = (ctx, a) => {
  const x = at(ctx, a, ["see", "build"]);
  if (fail(x)) return err(x);
  x.st.shownModel = true;
  x.st.stage = "see";
  ctx.note(`Opened the whole model of "${ctx.map.nodes[x.step].title}".`);
  return ok(ctx);
};

const onBuild =
  (f: (x: At, b: Build, a: Raw) => string | null | undefined): Act =>
  (ctx, a) => {
    const x = at(ctx, a, ["build"]);
    if (fail(x)) return err(x);
    const problem = f(x, buildOf(x), a);
    if (problem) return err(problem);
    return ok(ctx);
  };

const check: Act = (ctx, a) => {
  const x = at(ctx, a, ["build"]);
  if (fail(x)) return err(x);
  const b = buildOf(x);
  // an item you got wrong while sure last time: its refutation, right after the check
  const refutes: string[] = [];
  for (const i of itemsOf(x.s, x.main.id))
    if (i.refute && x.m === x.main) {
      const l = x.main.links.find((y) => y.id === i.ref);
      const mc =
        x.main.miscon.find(
          (y) =>
            y.link &&
            l &&
            [y.link.from, y.link.to].sort().join() ===
              [l.from, l.to].sort().join(),
        ) ?? x.main.miscon[0];
      if (mc && !refutes.includes(mc.refute)) refutes.push(mc.refute);
      delete i.refute;
    }
  const result = grade(x.m, b, {
    keyOnly: b.help === 0 || !!x.st.recall,
    now: clock(),
    refutes,
  });
  if (!b.checks) {
    b.first = Object.fromEntries(
      x.m.links
        .filter((l) => l.key && !l.argued)
        .map((l) => [
          l.id,
          b.links.some(
            (y) =>
              !y.given && y.from === l.from && y.to === l.to && y.rel === l.rel,
          ),
        ]),
    );
    if (b.sure) b.firstSure = b.sure;
  }
  b.checks++;
  b.last = result;
  delete b.typed;
  ctx.note(
    `Checked the build of "${ctx.map.nodes[x.step].title}": ${result.right} of ${result.total} right${result.pass ? ", passed" : ""}.`,
  );
  if (result.pass) passed(x, b);
  return ok(ctx, result.pass);
};

const hintBuild: Act = (ctx, a) => {
  const x = at(ctx, a, ["build"]);
  if (fail(x)) return err(x);
  const b = buildOf(x);
  const h = nextHint(x.m, b);
  if (typeof h === "string") return err(h);
  b.hints.push(h);
  return ok(ctx);
};

const showLink: Act = (ctx, a) => {
  const x = at(ctx, a, ["build"]);
  if (fail(x)) return err(x);
  const b = buildOf(x);
  if (!b.checks) return err("Check once first.");
  const l = showOneLink(x.m, b);
  if (typeof l === "string") return err(l);
  ctx.note(`Was shown the link ${linkWords(x.m, l)}.`);
  return ok(ctx);
};

const type: Act = (ctx, a) => {
  const x = at(ctx, a, ["build"]);
  if (fail(x)) return err(x);
  const b = buildOf(x);
  const text = str(a?.text, 60).trim();
  if (!text) return err("Type a part's name.");
  const r = matchPart(x.m, text);
  if ("part" in r) {
    const problem = placePart(x.m, b, r.part, a);
    if (problem) return err(problem);
    delete b.typed;
    return ok(ctx);
  }
  b.typed = { text, suggest: r.suggest };
  return ok(ctx, false);
};

// "Did you mean": the pick counts as hinted, and the form you typed is
// remembered as one of the part's names.
const pick: Act = (ctx, a) => {
  const x = at(ctx, a, ["build"]);
  if (fail(x)) return err(x);
  const b = buildOf(x);
  const part = x.m.parts.find((p) => p.label === a?.label);
  if (!part || !b.typed?.suggest.includes(part.label))
    return err("Pick one of the names offered.");
  const problem = placePart(x.m, b, part.id, a);
  if (problem) return err(problem);
  const typed = b.typed.text.toLowerCase().slice(0, 40);
  if (typed && !part.learned.includes(typed)) part.learned.push(typed);
  (b.hinted ??= []).push(part.id);
  delete b.typed;
  return ok(ctx);
};

const why: Act = async (ctx, a) => {
  const x = at(ctx, a, ["why"]);
  if (fail(x)) return err(x);
  const { st, main, step } = x;
  const link = main.links.find((l) => l.id === st.whyLink);
  if (a?.show === true || !link?.ask) {
    st.why = { state: "shown", tries: st.why?.tries ?? 0 };
    built(ctx, x);
    return ok(ctx);
  }
  const text = str(a?.text, 600).trim();
  const pre = whyPrecheck(text, main);
  if (pre) {
    st.pre = pre;
    return ok(ctx, false);
  }
  delete st.pre;
  if (ctx.engine.isQueuedOrRunning(step, JUDGING)) return {};
  const prev = st.why?.state;
  st.why = { state: prev ?? "wrong", tries: (st.why?.tries ?? 0) + 1, say: "" };
  const asked = st.why;
  ctx.say(text);
  const r = await ctx.engine.turn(
    `WHY on step [${step}] "${ctx.map.nodes[step].title}": the learner answers the question on the key link [${link.id}] ${linkWords(main, link)}: "${link.ask}". Judge their answer against that link's rubric with one why op (model "${main.id}", link "${link.id}").`,
    ctx.settings,
    { text, label: JUDGING, nodeId: step, sections: ["why"] },
  );
  if (r.error || r.stopped) return r;
  if (st.why !== asked || !asked.say) {
    // no verdict came back: the step stands as it was before you sent it
    if (st.why === asked)
      st.why = prev ? { state: prev, tries: asked.tries } : undefined;
    ctx.engine.push();
    return { ...r, error: "Claude did not judge it. Try again." };
  }
  if (asked.state === "right" && st.stage === "why") built(ctx, x);
  return ok(ctx, asked.state === "right");
};

const whatif: Act = (ctx, a) => {
  const x = at(ctx, a, ["built"]);
  if (fail(x)) return err(x);
  if (!x.main.whatif) return err("This step has no what-if.");
  const clicked = Array.isArray(a?.parts)
    ? a.parts.map(id).filter(Boolean)
    : [];
  if (!clicked.length) return err("Click the parts that stop working first.");
  const r = whatIf(x.main, clicked);
  x.st.whatif = r;
  const perfect = !r.missed && !r.extra.length;
  x.st.rungs.whatif ??= perfect ? "you" : "shown";
  const item = own(x.s.items, `${x.main.id}:whatif`);
  const sure = isSure(a?.sure) ? a.sure : undefined;
  if (item) record(item, perfect ? "unaided" : "wrong", clock(), sure);
  return ok(ctx, perfect);
};

const argue: Act = async (ctx, a) => {
  const x = at(ctx, a, ["build"]);
  if (fail(x)) return err(x);
  const b = buildOf(x);
  const l = b.links.find((y) => y.id === id(a?.link));
  if (!l || b.last?.marks.find((y) => y.link === l.id)?.mark !== "extra")
    return err(
      "Argue for a link the last check marked as not in Claude's model.",
    );
  const text = str(a?.text, 400).trim();
  if (!text) return err("Say in a line why it holds.");
  b.argue = { from: l.from, to: l.to, rel: l.rel, said: text };
  ctx.say(text);
  const r = await ctx.engine.turn(
    `ARGUE on step [${x.step}] "${ctx.map.nodes[x.step].title}": the learner drew ${linkWords(x.m, l)}, which is not in your model, and says why it holds. Say whether it holds in this case with one accept op (model "${x.m.id}", link {"from":"${l.from}","to":"${l.to}","rel":"${l.rel}"}).`,
    ctx.settings,
    { text, label: "Weighing your link", nodeId: x.step, sections: ["argue"] },
  );
  if (r.error || r.stopped) return r;
  if (b.argue) {
    delete b.argue;
    return { ...r, error: "Claude did not say. Try again." };
  }
  return ok(ctx, b.argued?.at(-1)?.holds ?? false);
};

const newCase: Act = (ctx, a) => {
  const x = at(ctx, a, ["built"]);
  if (fail(x)) return err(x);
  if (ctx.engine.isQueuedOrRunning(x.step, NEW_CASE)) return {};
  const { s, step, main } = x;
  return writeModel(ctx, {
    action: `NEW CASE for step [${step}] "${ctx.map.nodes[step].title}": write a new case of model "${main.id}" (a model op with "of":"${main.id}", step "${step}", then its links, miscon and whatif ops). Nothing else in the block.`,
    label: NEW_CASE,
    nodeId: step,
    sections: ["model", "case"],
    target: () => {
      const st = s.steps[step];
      return st.caseModel ? own(s.models, st.caseModel) : undefined;
    },
    step: () => step,
    onReady: (c) => {
      // you build the new case at L2: the frame drawn, the parts in the tray
      const st = s.steps[step];
      if (st.stage !== "built") return;
      st.onCase = true;
      st.stage = "build";
      s.builds[c.id] = startBuild(c, 2);
    },
  });
};

// Go deeper on a part: a step "Inside: <part>" under the step; its model is
// written when you open it.
function deeperBuild(ctx: Ctx, a: Raw): ActionResult {
  const x = at(ctx, a);
  if (fail(x)) return err(x);
  const part = x.main.parts.find((p) => p.id === id(a?.part));
  if (!part) return err("Pick a part to go deeper on.");
  const title = `Inside: ${part.label}`;
  const nodes = ctx.map.nodes;
  const there = Object.values(nodes).find(
    (n) => n.parent === x.step && n.title === title,
  );
  if (there) return { ok: true, nodeId: there.id };
  const base = `${x.step}-in-${part.id}`.slice(0, 56);
  let nid = base;
  for (let n = 2; own(nodes, nid); n++) nid = `${base}-${n}`;
  makeNode(nodes, {
    id: nid,
    parent: x.step,
    kind: "question",
    title,
    summary: `What is inside "${part.label}", and what breaks?`,
    by: "you",
  });
  ctx.note(`Went deeper on "${part.label}" in step "${nodes[x.step].title}".`);
  ctx.engine.push();
  return { ok: true, nodeId: nid };
}

const recall: Act = (ctx, a) => {
  const x = at(ctx, a, ["built"]);
  if (fail(x)) return err(x);
  if (!x.st.recallDue) return err("No quick rebuild is waiting on this step.");
  x.st.recallDue = false;
  x.st.recall = true;
  x.st.onCase = false;
  x.st.stage = "build";
  fresh({ ...x, m: x.main }, 1);
  return ok(ctx);
};

// Review: the due steps in mixed order, each at the help its weakest item
// earns. A second press while one is open keeps it.
const review: Act = (ctx) => {
  const s = state(ctx.map);
  if (!s) return err("This map is not practised as builds.");
  if (s.review) return ok(ctx);
  const t = clock();
  const path = pathSteps(ctx.map.nodes).map((p) => p.id);
  const due = path.filter((step) => {
    const m = modelOf(s, step);
    const st = s.steps[step];
    // a step part way through a new case is built too: the review takes it
    // back to its own model
    return (
      m &&
      (st?.stage === "built" || !!st?.onCase) &&
      itemsOf(s, m.id).some((i) => !i.retired && i.due <= t)
    );
  });
  if (!due.length) return err("Nothing is due for review.");
  const seed = seedOf(`${ctx.map.id}:${localDay(t)}`);
  const order = mixedOrder(due, seed);
  let items = 0;
  let seen = 0;
  for (const i of Object.values(s.items)) {
    seen = Math.max(seen, i.made, ...i.log.map((e) => e.at));
    const m = own(s.models, i.model);
    if (
      i.kind === "link" &&
      !i.retired &&
      i.due <= t &&
      m &&
      due.includes(m.step)
    )
      items++;
  }
  for (const step of order) {
    const st = s.steps[step];
    const m = modelOf(s, step)!;
    st.reviewing = true;
    st.onCase = false;
    st.stage = "build";
    st.help = helpFor(itemsOf(s, m.id), st.recallWrong);
    st.recallWrong = false;
    s.builds[m.id] = startBuild(m, st.help);
  }
  const builtSteps = path.filter(
    (step) => s.steps[step]?.stage === "built" || s.steps[step]?.reviewing,
  );
  s.review = {
    at: t,
    since: seen ? Math.round((t - seen) / DAY) : null,
    order,
    items,
    cards: ideaCards(s, order, builtSteps, seed),
  };
  ctx.note(`Opened a review: ${order.length} step(s) due.`);
  return ok(ctx);
};

const idea: Act = (ctx, a) => {
  const s = state(ctx.map);
  const card = s?.review?.cards.find((c) => c.id === a?.card);
  if (!s || !card) return err("No such card.");
  if (!card.choices.includes(a?.pick)) return err("Pick one of the steps.");
  card.picked ??= a.pick;
  return ok(ctx, card.picked === card.answer);
};

// I'm done today: what you rebuilt is logged, what you did not stays due,
// and the visit's unaided score is kept.
const done: Act = (ctx) => {
  const s = state(ctx.map);
  if (!s?.review) return err("No review is open.");
  for (const step of s.review.order) {
    const st = own(s.steps, step);
    const m = modelOf(s, step);
    if (!st?.reviewing || !m) continue;
    const b = own(s.builds, m.id);
    if (b?.checks) logBuild({ s, step, st, main: m, m }, b);
    st.reviewing = false;
    st.stage = "built";
  }
  const today = unaidedSince(s, s.review.at);
  s.visits.push({
    at: s.review.at,
    unaided: today.unaided,
    of: Math.max(s.review.items, today.of),
  });
  s.review = null;
  ctx.note(
    `Ended today's review: ${today.unaided} of ${today.of} key links unaided.`,
  );
  return ok(ctx);
};

const sure: Act = onBuild((_x, b, a) => {
  if (!isSure(a?.sure)) return "Say how sure you are.";
  b.sure = a.sure;
  return null;
});

export const BUILD_ACTIONS: Record<string, Act> = {
  level,
  open,
  predict,
  hide,
  showModel,
  place: onBuild((x, b, a) =>
    b.help === 3 ? "Type the part's name." : placePart(x.m, b, id(a?.part), a),
  ),
  move: onBuild((x, b, a) => movePart(x.m, b, id(a?.part), a ?? {})),
  unplace: onBuild((_x, b, a) => unplacePart(b, id(a?.part))),
  link: onBuild((x, b, a) => {
    const r = linkParts(x.m, b, id(a?.from), id(a?.to), a?.rel);
    return typeof r === "string" ? r : null;
  }),
  relink: onBuild((x, b, a) =>
    relinkParts(x.m, b, id(a?.link), { rel: a?.rel, reverse: a?.reverse }),
  ),
  unlink: onBuild((_x, b, a) => unlinkParts(b, id(a?.link))),
  type,
  pick,
  check,
  hint: hintBuild,
  showLink,
  sure,
  why,
  whatif,
  argue,
  newCase,
  deeper: deeperBuild,
  recall,
  review,
  idea,
  done,
  practise,
};

// the actions only a build-mode map takes (hint and deeper are shared with
// the classic screen, which sends them as core actions)
export const isBuildMap = (map: StoredMap) => !!state(map);
