// Learn's build mode, pure logic and no I/O: cleaning and checking the
// models Claude writes, grading what you build against them, the help each
// level gives, the review schedule, what Claude reads each move and what the
// browser sees. Time always comes in as `now`, so every rule here is tested
// without a clock.

import {
  familyOf,
  HELP,
  isVerb,
  LAYERS,
  LEVEL_HELP,
  RUNGS,
  slotsOf,
  STEMS,
  SURES,
  verbsFor,
  type CheckResult,
  type Credit,
  type Frame,
  type Help,
  type HintView,
  type How,
  type Layer,
  type LearnView,
  type Level,
  type LinkMark,
  type LinkView,
  type PartView,
  type ReviewView,
  type Rung,
  type Stage,
  type StepView,
  type Sure,
  type Verb,
  type WhyState,
} from "./shared.ts";
import { normAnswer } from "../../server/core/diagram.ts";
import { list, own, safeId, str, type Raw } from "../../server/core/types.ts";
import type { MapNode } from "../../shared/model.ts";

export const DAY = 86_400_000;
// a review item's box, and how many days it waits before it is due again
export const BOXES = [0, 1, 3, 7, 16, 35] as const;
// the share of the non-key links a build must have right or given
export const PASS_SHARE = 0.7;

// ---------------------------------------------------------------- state

export type Part = {
  id: string;
  label: string;
  role: string;
  // forms of the name typed at L3 that count: Claude's, then ones you confirmed
  accept: string[];
  learned: string[];
  slot?: string[];
};
export type RefLink = {
  id: string;
  from: string;
  to: string;
  rel: Verb;
  key: boolean;
  hint?: string;
  ask?: string;
  rubric?: string;
  reversed?: string;
  // a link you argued for and Claude accepted: it counts as right from then on
  argued?: true;
};
export type Miscon = {
  id: string;
  claim: string;
  refute: string;
  link?: { from: string; to: string; rel: Verb };
};
export type Predict = {
  ask: string;
  choices: { text: string; miscon?: string }[];
  answer: string;
  hides: string;
};
export type WhatIf = {
  fails: string;
  ask: string;
  affected: string[];
  why: string;
};
export type RefModel = {
  id: string;
  step: string;
  // a new case: the model it is a new surface of
  of?: string;
  mode: "build" | "play";
  layer: Layer;
  title: string;
  case: string;
  frame: Frame;
  parts: Part[];
  links: RefLink[];
  miscon: Miscon[];
  predict?: Predict;
  whatif?: WhatIf;
  // shown only once it held together (validate); broken after the retry failed
  status: "writing" | "ready" | "broken";
  problems?: string[];
};

export type StepState = {
  stage: Stage;
  help: Help;
  predicted?: { pick: string; sure: Sure };
  // the key link asked about this visit (it rotates)
  whyLink?: string;
  why?: { state: WhyState; tries: number; say?: string };
  // the server's own reply to a why it refused before any model call
  pre?: string;
  rungs: Record<Rung, Credit | null>;
  // a quick rebuild waiting (in-session spacing), and one only, ever
  recallDue?: boolean;
  recallDone?: boolean;
  // a quick rebuild under way; and one that came out wrong lowers the next
  // visit's help by one
  recall?: boolean;
  recallWrong?: boolean;
  // a review rebuild under way
  reviewing?: boolean;
  // Show the model is open: the worked case stays on screen
  shownModel?: boolean;
  // the build passed only through Show the model
  viaModel?: boolean;
  // a new case on this step, and whether you are building it now
  caseModel?: string;
  onCase?: boolean;
  whatif?: { found: string[]; missed: number; extra: string[] };
};

export type BuildLink = {
  id: string;
  from: string;
  to: string;
  rel: Verb;
  given?: true;
};
export type Build = {
  help: Help;
  placed: { part: string; x: number; y: number; slot?: string }[];
  links: BuildLink[];
  hints: { link: string; rung: 1 | 2 | 3 }[];
  shown: string[];
  checks: number;
  last: CheckResult | null;
  sure?: Sure;
  // how each key link stood at the first check, and how sure you were then
  first?: Record<string, boolean>;
  firstSure?: Sure;
  // parts you placed through "did you mean": they count as hinted
  hinted?: string[];
  typed?: { text: string; suggest: string[] };
  // a link you argued for, waiting for Claude's verdict, and the verdicts
  argue?: { from: string; to: string; rel: Verb; said: string };
  argued?: {
    from: string;
    to: string;
    rel: Verb;
    holds: boolean;
    say: string;
  }[];
  // the next id for a link of yours
  next: number;
};

export type Item = {
  id: string;
  model: string;
  kind: "link" | "whatif";
  ref: string;
  box: 0 | 1 | 2 | 3 | 4 | 5;
  due: number;
  retired: boolean;
  // when the step was built: the first day never counts as a review
  made: number;
  log: { at: number; how: How; sure?: Sure }[];
  // wrong while sure: its refutation comes back right after its next check
  refute?: true;
};

export type Card = {
  id: string;
  ask: string;
  choices: string[];
  answer: string;
  picked?: string;
};
export type Review = {
  at: number;
  since: number | null;
  order: string[];
  // key links due when the review opened: the "of" in Today, unaided
  items: number;
  cards: Card[];
};

export type LearnState = {
  v: 1;
  // classic: the topic diagram and blanks, as before; new maps are build
  mode: "classic" | "build";
  level: Level | null;
  models: Record<string, RefModel>;
  stepModel: Record<string, string>;
  steps: Record<string, StepState>;
  builds: Record<string, Build>;
  items: Record<string, Item>;
  visits: { at: number; unaided: number; of: number }[];
  // the model's own model ids this map has seen → the ids they are kept
  // under, so a later step's "m1" never overwrites the first step's
  alias: Record<string, string>;
  review: Review | null;
  // the step being worked on: Claude reads it in full, the others in a line
  at?: string;
};

export const newState = (mode: "classic" | "build"): LearnState => ({
  v: 1,
  mode,
  level: null,
  models: {},
  stepModel: {},
  steps: {},
  builds: {},
  items: {},
  visits: [],
  alias: {},
  review: null,
});

// a map's Learn state, if it has one; a map without it is a classic map
export function peek(
  data: Record<string, unknown> | undefined,
): LearnState | null {
  const s = data?.learn as LearnState | undefined;
  return s && typeof s === "object" && s.v === 1 ? s : null;
}

const noRungs = (): Record<Rung, Credit | null> =>
  Object.fromEntries(RUNGS.map((r) => [r, null])) as Record<
    Rung,
    Credit | null
  >;

// a step's state as it starts: the level chooser decides See or not, and the
// help of the first build
export const freshStep = (level: Level | null): StepState => ({
  stage: level && level !== "new" ? "build" : "see",
  help: level ? LEVEL_HELP[level] : 0,
  rungs: noRungs(),
});

// ---------------------------------------------------------------- the path

export type PathStep = { id: string; depth: number; parent: string | null };

// The steps in path order, each "Go deeper" step right after its parent.
// Only live ones: a step Explore set aside or removed keeps its model and
// items on disk, and they come back with it.
export function pathSteps(nodes: Record<string, MapNode>): PathStep[] {
  const all = Object.values(nodes);
  const root = all
    .filter((n) => !n.parent)
    .sort((a, b) => a.order - b.order)[0];
  if (!root) return [];
  const out: PathStep[] = [];
  const walk = (parent: string, depth: number) => {
    for (const n of all
      .filter((x) => x.parent === parent && x.kind === "question" && !x.dropped)
      .sort((a, b) => a.order - b.order)) {
      out.push({ id: n.id, depth, parent: depth ? parent : null });
      if (depth < 3) walk(n.id, depth + 1);
    }
  };
  walk(root.id, 0);
  return out;
}

// ---------------------------------------------------------------- cleaning

const clean = (v: unknown, n: number): string => str(v, n).trim();
const safe = (v: unknown): string => {
  const s = clean(v, 60);
  return safeId(s) ? s : "";
};

export function cleanFrame(raw: Raw): Frame {
  const names = (v: unknown, n: number) =>
    [
      ...new Set(
        list(v, n)
          .map((x) => clean(x, 30))
          .filter(Boolean),
      ),
    ] as string[];
  switch (raw?.kind) {
    case "lanes": {
      const lanes = names(raw.lanes, 6);
      return lanes.length ? { kind: "lanes", lanes } : { kind: "free" };
    }
    case "axis": {
      const ticks = names(raw.ticks, 10);
      return ticks.length ? { kind: "axis", ticks } : { kind: "free" };
    }
    case "sort": {
      const columns = names(raw.columns, 5);
      return columns.length ? { kind: "sort", columns } : { kind: "free" };
    }
    case "boxes": {
      const boxes: { id: string; label: string }[] = [];
      for (const b of list(raw.boxes, 8)) {
        const id = safe(b?.id);
        const label = clean(b?.label, 30);
        if (id && label && !boxes.some((x) => x.id === id))
          boxes.push({ id, label });
      }
      return boxes.length ? { kind: "boxes", boxes } : { kind: "free" };
    }
    default:
      return { kind: "free" };
  }
}

// A part's slot must be one the frame has; only a sort frame takes a list
// (a contested claim may fairly sit in more than one column).
function cleanSlot(raw: unknown, frame: Frame): string[] | undefined {
  const valid = slotsOf(frame);
  const given = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
    .map((x) => clean(x, 30))
    .filter((x) => valid.includes(x));
  const slots = frame.kind === "sort" ? [...new Set(given)] : given.slice(0, 1);
  return slots.length ? slots : undefined;
}

function cleanPart(raw: Raw, frame: Frame): Part | null {
  const id = safe(raw?.id);
  const label = clean(raw?.label, 40);
  if (!id || !label) return null;
  const slot = cleanSlot(raw?.slot, frame);
  return {
    id,
    label,
    role: clean(raw?.role, 120),
    accept: list(raw?.accept, 6)
      .map((a) => clean(a, 40))
      .filter(Boolean),
    learned: [],
    ...(slot ? { slot } : {}),
  };
}

// A model op, cleaned. It keeps the model's own id here; the server files it
// under an id of its own (see LearnState.alias).
export function cleanModel(op: Raw): RefModel | null {
  const step = safe(op?.step);
  if (!step) return null;
  const frame = cleanFrame(op?.frame);
  const parts: Part[] = [];
  // a ninth part is cut
  for (const p of list(op?.parts, 8)) {
    const c = cleanPart(p, frame);
    if (c && !parts.some((x) => x.id === c.id)) parts.push(c);
  }
  const of = safe(op?.of);
  return {
    id: safe(op?.id) || `m-${step}`,
    step,
    ...(of ? { of } : {}),
    mode: op?.mode === "play" ? "play" : "build",
    layer: LAYERS.includes(op?.layer) ? op.layer : "behaviour",
    title: clean(op?.title, 80),
    case: clean(op?.case, 160),
    frame,
    parts,
    links: [],
    miscon: [],
    status: "writing",
  };
}

const isPart = (m: RefModel, id: string) => m.parts.some((p) => p.id === id);

// A link's ends must be parts of its model and its verb one the frame
// allows; anything else is dropped. A link sent again by id replaces it.
export function addLinks(m: RefModel, raw: Raw): number {
  const allowed = verbsFor(m.frame.kind);
  let n = 0;
  for (const l of list(raw, 12)) {
    const id = safe(l?.id);
    const from = safe(l?.from);
    const to = safe(l?.to);
    const rel = l?.rel;
    if (!id || !isPart(m, from) || !isPart(m, to) || from === to) continue;
    if (!isVerb(rel) || !allowed.includes(rel)) continue;
    const link: RefLink = { id, from, to, rel, key: l?.key === true };
    for (const k of ["hint", "ask", "reversed"] as const) {
      const v = clean(l?.[k], 200);
      if (v) link[k] = v;
    }
    const rubric = clean(l?.rubric, 300);
    if (rubric) link.rubric = rubric;
    const at = m.links.findIndex((x) => x.id === id);
    if (at >= 0) m.links[at] = link;
    else if (m.links.filter((x) => !x.argued).length < 10) m.links.push(link);
    else continue;
    n++;
  }
  return n;
}

export function addMiscon(m: RefModel, raw: Raw): number {
  let n = 0;
  for (const x of list(raw, 3)) {
    const id = safe(x?.id);
    const claim = clean(x?.claim, 160);
    const refute = clean(x?.refute, 240);
    if (!id || !claim || !refute || m.miscon.some((y) => y.id === id)) continue;
    if (m.miscon.length >= 3) break;
    const item: Miscon = { id, claim, refute };
    const l = x?.link;
    const from = safe(l?.from);
    const to = safe(l?.to);
    if (isPart(m, from) && isPart(m, to) && from !== to && isVerb(l?.rel))
      item.link = { from, to, rel: l.rel };
    m.miscon.push(item);
    n++;
  }
  return n;
}

export function setPredict(m: RefModel, op: Raw): boolean {
  const ask = clean(op?.ask, 200);
  const choices = list(op?.choices, 4)
    .map((c) => {
      const text = clean(typeof c === "string" ? c : c?.text, 60);
      const miscon = safe(c?.miscon);
      return text ? { text, ...(miscon ? { miscon } : {}) } : null;
    })
    .filter((c): c is { text: string; miscon?: string } => !!c);
  if (!ask || choices.length < 2) return false;
  m.predict = {
    ask,
    choices,
    answer: clean(op?.answer, 60),
    hides: safe(op?.hides),
  };
  return true;
}

export function setWhatIf(m: RefModel, op: Raw): boolean {
  const ask = clean(op?.ask, 200);
  const fails = safe(op?.fails);
  if (!ask || !fails) return false;
  m.whatif = {
    fails,
    ask,
    affected: [...new Set(list(op?.affected, 8).map(safe).filter(Boolean))],
    why: clean(op?.why, 200),
  };
  return true;
}

// ---------------------------------------------------------------- checks

const labelOf = (m: RefModel, id: string) =>
  m.parts.find((p) => p.id === id)?.label ?? id;
export const linkWords = (
  m: RefModel,
  l: { from: string; to: string; rel: Verb },
) => `"${labelOf(m, l.from)}" ${l.rel} "${labelOf(m, l.to)}"`;

// words with single spaces around them, so a label matches as a phrase
const phrase = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

// The key links a text gives away: it holds both end labels and the verb (or
// its stem). The longer label is matched first and taken out, so "B cell"
// is not found inside "Memory B cell".
export function givesAway(m: RefModel, text: string): string[] {
  const t = phrase(text);
  const out: string[] = [];
  for (const l of m.links) {
    if (!l.key) continue;
    const a = phrase(labelOf(m, l.from));
    const b = phrase(labelOf(m, l.to));
    if (a.trim() === "" || b.trim() === "") continue;
    const [long, short] = a.length >= b.length ? [a, b] : [b, a];
    if (!t.includes(long)) continue;
    if (!t.split(long).join(" ").includes(short)) continue;
    if (t.includes(` ${STEMS[l.rel]}`)) out.push(l.id);
  }
  return out;
}

// Everything a model must be before it is shown. Each problem is said in
// words Claude can act on in its one retry.
export function validate(
  m: RefModel,
  step?: { title: string; summary: string },
): string[] {
  const p: string[] = [];
  const links = m.links.filter((l) => !l.argued);
  const keys = links.filter((l) => l.key);
  if (m.parts.length < 4 || m.parts.length > 8)
    p.push(`it has ${m.parts.length} parts; a model needs 4 to 8`);
  if (links.length < 3 || links.length > 10)
    p.push(`it has ${links.length} links; a model needs 3 to 10`);
  if (keys.length < 2 || keys.length > 3)
    p.push(`it has ${keys.length} key links; a model needs 2 or 3`);
  if (m.miscon.length > 3)
    p.push(`it has ${m.miscon.length} misconceptions; at most 3`);
  for (const l of keys)
    for (const k of ["hint", "ask", "rubric"] as const)
      if (!l[k]) p.push(`the key link ${linkWords(m, l)} has no ${k}`);
  for (const a of m.parts)
    for (const b of m.parts)
      if (a !== b && phrase(a.role).includes(phrase(b.label)))
        p.push(`the role of "${a.label}" names another part, "${b.label}"`);
  if (m.predict) {
    if (
      !m.predict.choices.some(
        (c) => normAnswer(c.text) === normAnswer(m.predict!.answer),
      )
    )
      p.push(
        `the predict answer "${m.predict.answer}" is not one of its choices`,
      );
    if (m.predict.hides && !links.some((l) => l.id === m.predict!.hides))
      p.push(`the predict hides "${m.predict.hides}", which is not a link`);
  }
  if (m.whatif) {
    if (!isPart(m, m.whatif.fails))
      p.push(`the what-if fails "${m.whatif.fails}", which is not a part`);
    if (
      m.whatif.affected.some((id) => !isPart(m, id)) ||
      !m.whatif.affected.length
    )
      p.push(
        "the what-if's affected list names parts that are not in the model",
      );
  }
  if (m.mode === "play" && m.frame.kind !== "axis")
    p.push("a play step's model is a subgoal order on an axis frame");
  if (step)
    for (const id of givesAway(m, step.title)) {
      const l = m.links.find((x) => x.id === id)!;
      p.push(`the step title gives away the key link ${linkWords(m, l)}`);
    }
  return p;
}

// the part of a summary before its first comma, colon, dash or "because"
export const firstClause = (s: string): string =>
  s.split(/[,;:(—–]| - | because | so that | which /)[0].trim();

// Take giveaways out of what the learner reads before they build: a hint that
// gives a key link away drops its rung; a summary is cut to its first clause
// (or emptied); a predict that gives its answer away is dropped.
export function scrub(
  m: RefModel,
  step: { title: string; summary: string },
): { summary: string | null; hints: string[]; predict: boolean } {
  const hints: string[] = [];
  for (const l of m.links)
    if (l.hint && givesAway(m, l.hint).length) {
      delete l.hint;
      hints.push(l.id);
    }
  let predict = false;
  if (m.predict) {
    const answer = phrase(m.predict.answer);
    const inStep =
      answer.trim() !== "" &&
      (phrase(step.title).includes(answer) ||
        phrase(step.summary).includes(answer));
    if (givesAway(m, m.predict.ask).length || inStep) {
      delete m.predict;
      predict = true;
    }
  }
  let summary: string | null = null;
  if (step.summary && givesAway(m, step.summary).length) {
    const cut = firstClause(step.summary);
    summary = givesAway(m, cut).length ? "" : cut;
  }
  return { summary, hints, predict };
}

// ---------------------------------------------------------------- grading

const sameLink = (
  a: { from: string; to: string; rel: Verb },
  b: { from: string; to: string; rel: Verb },
) => a.from === b.from && a.to === b.to && a.rel === b.rel;

// Your build against the reference (and the links you argued for). Only the
// key links decide a pass, and 70% of the rest; at L0 and in a quick rebuild
// only the key links count. A link Claude does not have is never wrong.
export function grade(
  m: RefModel,
  b: Build,
  { keyOnly = false, now = 0, refutes = [] as string[] } = {},
): CheckResult {
  const refs = m.links;
  const counted = refs.filter((l) => !l.argued && (!keyOnly || l.key));
  const right = new Set<string>();
  const given = new Set<string>();
  const touched = new Set<string>();
  const marks: LinkMark[] = [];
  let reversed = 0;
  let family = 0;
  let miscon = 0;
  let extra = 0;
  const halves = new Set<string>();
  // exact matches first, so a wrong try drawn earlier never takes a right one's place
  const exact = new Map<string, RefLink>();
  for (const l of b.links) {
    const r = refs.find(
      (x) => sameLink(x, l) && !right.has(x.id) && !given.has(x.id),
    );
    if (!r) continue;
    exact.set(l.id, r);
    (l.given ? given : right).add(r.id);
    touched.add(r.id);
  }
  for (const l of b.links) {
    if (l.given) continue;
    if (exact.has(l.id)) {
      marks.push({ link: l.id, mark: "right" });
      continue;
    }
    const x = m.miscon.find((y) => y.link && sameLink(y.link, l));
    if (x) {
      miscon++;
      marks.push({ link: l.id, mark: "miscon", refute: x.refute });
      continue;
    }
    const rev = refs.find(
      (r) =>
        r.from === l.to &&
        r.to === l.from &&
        familyOf(r.rel) === familyOf(l.rel),
    );
    if (rev) {
      reversed++;
      touched.add(rev.id);
      marks.push({
        link: l.id,
        mark: "reversed",
        ...(rev.reversed ? { note: rev.reversed } : {}),
      });
      continue;
    }
    const fam = refs.find(
      (r) =>
        r.from === l.from &&
        r.to === l.to &&
        familyOf(r.rel) === familyOf(l.rel),
    );
    if (fam) {
      family++;
      touched.add(fam.id);
      if (!right.has(fam.id)) halves.add(fam.id);
      marks.push({ link: l.id, mark: "family" });
      continue;
    }
    extra++;
    marks.push({ link: l.id, mark: "extra" });
  }
  const got = (r: RefLink) => right.has(r.id) || given.has(r.id);
  const keys = counted.filter((r) => r.key);
  const rest = counted.filter((r) => !r.key);
  const restGot = rest.filter(got).length;
  const pass =
    keys.length > 0 &&
    keys.every(got) &&
    (keyOnly || !rest.length || restGot / rest.length >= PASS_SHARE);
  const half = counted.filter((r) => halves.has(r.id) && !got(r)).length;
  const rightN = counted.filter((r) => right.has(r.id)).length;
  return {
    at: now,
    help: b.help,
    keyOnly,
    total: counted.length,
    right: rightN,
    given: counted.filter((r) => given.has(r.id)).length,
    missing: counted.filter((r) => !got(r) && !touched.has(r.id)).length,
    keys: keys.length,
    keyRight: keys.filter(got).length,
    keyMissing: keys.filter((r) => !got(r) && !touched.has(r.id)).length,
    reversed,
    family,
    miscon,
    extra,
    score: counted.length ? (rightN + half / 2) / counted.length : 0,
    marks,
    ...placement(m, b),
    refutes,
    pass,
  };
}

// Lanes, boxes and sort: is each placed part in one of its slots? Axis: how
// many pairs of parts sit in the wrong order along it.
export function placement(
  m: RefModel,
  b: Build,
): { slots: { part: string; ok: boolean }[]; outOfOrder: number } {
  const ref = new Map(m.parts.map((p, i) => [p.id, { p, i }]));
  if (m.frame.kind === "axis") {
    const ticks = m.frame.ticks;
    const rank = (p: Part, i: number) => {
      const t = p.slot ? ticks.indexOf(p.slot[0]) : -1;
      return t >= 0 ? t : i;
    };
    const placed = b.placed.filter((x) => ref.has(x.part));
    const bySlot = placed.every((x) => x.slot && ticks.includes(x.slot));
    const at = (x: (typeof placed)[number]) =>
      bySlot ? ticks.indexOf(x.slot!) : x.x;
    let out = 0;
    for (const a of placed)
      for (const c of placed) {
        const ra = ref.get(a.part)!;
        const rc = ref.get(c.part)!;
        if (rank(ra.p, ra.i) < rank(rc.p, rc.i) && at(a) > at(c)) out++;
      }
    return { slots: [], outOfOrder: out };
  }
  if (m.frame.kind === "free") return { slots: [], outOfOrder: 0 };
  return {
    slots: b.placed
      .filter((x) => ref.get(x.part)?.p.slot?.length)
      .map((x) => ({
        part: x.part,
        ok: !!x.slot && ref.get(x.part)!.p.slot!.includes(x.slot),
      })),
    outOfOrder: 0,
  };
}

// ---------------------------------------------------------------- typed names

export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = cur;
    }
  }
  return row[b.length];
}

const namesOf = (p: Part) =>
  [p.label, ...p.accept, ...p.learned].map(normAnswer).filter(Boolean);

// A part name typed at L3: Claude's accept list and the names you confirmed,
// then one slip of spelling for names of 5 letters or more; otherwise the 3
// closest labels as "did you mean".
export function matchPart(
  m: RefModel,
  typed: string,
): { part: string } | { suggest: string[] } {
  const t = normAnswer(typed);
  if (!t) return { suggest: [] };
  for (const p of m.parts) if (namesOf(p).includes(t)) return { part: p.id };
  for (const p of m.parts)
    if (namesOf(p).some((n) => n.length >= 5 && distance(n, t) <= 1))
      return { part: p.id };
  const near = m.parts
    .map((p) => ({
      label: p.label,
      d: Math.min(...namesOf(p).map((n) => distance(n, t))),
    }))
    .sort((a, b) => a.d - b.d || a.label.localeCompare(b.label));
  return { suggest: near.slice(0, 3).map((x) => x.label) };
}

// ---------------------------------------------------------------- what if, why, new case

export function whatIf(
  m: RefModel,
  clicked: string[],
): { found: string[]; missed: number; extra: string[] } {
  const affected = new Set(m.whatif?.affected ?? []);
  const picked = [...new Set(clicked)].filter((id) => isPart(m, id));
  return {
    found: picked.filter((id) => affected.has(id)),
    missed: [...affected].filter((id) => !picked.includes(id)).length,
    extra: picked.filter((id) => !affected.has(id)),
  };
}

const STOP = new Set(
  "the a an and or but of to in on at by for with from into onto is are was were be been being it its this that these those there their they them then than so as if not no do does did can could will would should may might must has have had which who whom what when where why how one two also just only more most less very much many some any all each every other another same such own out up down over under again once here because".split(
    " ",
  ),
);
const wordsOf = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const stem = (w: string) => (w.length > 3 ? w.replace(/s$/, "") : w);

// Before a Why reaches Claude: too short, or only the labels and roles said
// back, is refused here. Neither is a verdict, and neither costs a call.
export function whyPrecheck(text: string, m: RefModel): string | null {
  const words = wordsOf(text);
  if (words.length < 5) return "Say a little more.";
  const content = words.filter((w) => w.length >= 3 && !STOP.has(w)).map(stem);
  const seen = new Set(
    m.parts
      .flatMap((p) => wordsOf(`${p.label} ${p.role}`))
      .filter((w) => !STOP.has(w))
      .map(stem),
  );
  const copied = content.filter((w) => seen.has(w)).length;
  const fresh = new Set(content.filter((w) => !seen.has(w))).size;
  if (content.length && copied / content.length > 0.7 && fresh < 3)
    return "That says what; say why.";
  return null;
}

const bare = (s: string) => normAnswer(s.replace(/\d+([.,]\d+)?/g, ""));
const keyFamilies = (m: RefModel) =>
  [
    ...new Set(
      m.links.filter((l) => l.key && !l.argued).map((l) => familyOf(l.rel)),
    ),
  ]
    .sort()
    .join(",");

// A new case must look different: not the same parts with new numbers, not
// the same case, and the same kinds of verb on its key links.
export function caseShape(orig: RefModel, next: RefModel): string[] {
  const p: string[] = [];
  const labels = new Set(orig.parts.map((x) => bare(x.label)));
  const same = next.parts.filter((x) => labels.has(bare(x.label))).length;
  if (same * 2 > next.parts.length)
    p.push(
      "it keeps more than half of the original's part labels: change the shape of the problem, not just the numbers",
    );
  if (bare(next.case) && bare(next.case) === bare(orig.case))
    p.push("its case is the original's case with new numbers");
  if (keyFamilies(orig) !== keyFamilies(next))
    p.push(
      `its key links must use the same kinds of verb as the original's (${keyFamilies(orig) || "none"})`,
    );
  return p;
}

// ---------------------------------------------------------------- seeded order

export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Due steps in a shuffled order, stable for a seed, and never in path order
// when there are 3 or more (mixing them is the point).
export function mixedOrder(ids: readonly string[], seed: number): string[] {
  const out = shuffled(ids, seed);
  if (ids.length >= 3 && out.every((x, i) => x === ids[i]))
    out.push(out.shift()!);
  return out;
}

// ---------------------------------------------------------------- fading

const COL = 220;
const ROW = 110;

// What each help level gives before you start: L0 every part where the
// worked case had it and every link but the key ones; L1 every part on a
// plain grid in a shuffled order, no links; L2 and L3 nothing placed.
export function startBuild(m: RefModel, help: Help): Build {
  const b: Build = {
    help,
    placed: [],
    links: [],
    hints: [],
    shown: [],
    checks: 0,
    last: null,
    next: 1,
  };
  if (help === 0) {
    // layered left to right along the links, as the worked case is drawn
    const depth = new Map(m.parts.map((p) => [p.id, 0]));
    for (let i = 0; i < m.parts.length; i++)
      for (const l of m.links)
        depth.set(
          l.to,
          Math.max(
            depth.get(l.to)!,
            Math.min(m.parts.length, depth.get(l.from)! + 1),
          ),
        );
    const rows = new Map<number, number>();
    for (const p of m.parts) rows.set(depth.get(p.id)!, 0);
    const tall = Math.max(
      ...m.parts.map(
        (p) =>
          m.parts.filter((q) => depth.get(q.id) === depth.get(p.id)).length,
      ),
    );
    for (const p of m.parts) {
      const d = depth.get(p.id)!;
      const r = rows.get(d)!;
      rows.set(d, r + 1);
      // past four columns the layers fold into rows that run back the
      // other way, as the screen draws the worked case
      const fold = Math.floor(d / 4);
      const col = fold % 2 ? 3 - (d % 4) : d % 4;
      b.placed.push({
        part: p.id,
        x: col * COL,
        y: r * ROW + fold * (tall * ROW + 40),
        ...(p.slot ? { slot: p.slot[0] } : {}),
      });
    }
    for (const l of m.links)
      if (!l.key && !l.argued)
        b.links.push({
          id: `y${b.next++}`,
          from: l.from,
          to: l.to,
          rel: l.rel,
          given: true,
        });
  } else if (help === 1) {
    shuffled(m.parts, seedOf(m.id)).forEach((p, i) =>
      b.placed.push({
        part: p.id,
        x: (i % 3) * COL,
        y: Math.floor(i / 3) * ROW,
      }),
    );
  }
  return b;
}

// ---------------------------------------------------------------- your moves on a build

const placedHas = (b: Build, part: string) =>
  b.placed.some((p) => p.part === part);

// the next free spot: below the last part placed
const nextSpot = (b: Build) => ({
  x: (b.placed.length % 3) * COL,
  y: Math.floor(b.placed.length / 3) * ROW,
});

export function placePart(
  m: RefModel,
  b: Build,
  part: string,
  at?: { x?: unknown; y?: unknown; slot?: unknown },
): string | null {
  if (!isPart(m, part)) return "No such part.";
  if (placedHas(b, part)) return "That part is already placed.";
  const spot = nextSpot(b);
  const num = (v: unknown, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d;
  const slot = cleanSlot(at?.slot, m.frame)?.[0];
  b.placed.push({
    part,
    x: num(at?.x, spot.x),
    y: num(at?.y, spot.y),
    ...(slot ? { slot } : {}),
  });
  return null;
}

export function movePart(
  m: RefModel,
  b: Build,
  part: string,
  at: { x?: unknown; y?: unknown; slot?: unknown },
): string | null {
  const p = b.placed.find((x) => x.part === part);
  if (!p) return "That part is not placed.";
  if (typeof at.x === "number" && Number.isFinite(at.x)) p.x = Math.round(at.x);
  if (typeof at.y === "number" && Number.isFinite(at.y)) p.y = Math.round(at.y);
  if (at.slot !== undefined) {
    const slot = cleanSlot(at.slot, m.frame)?.[0];
    if (slot) p.slot = slot;
    else delete p.slot;
  }
  return null;
}

export function unplacePart(b: Build, part: string): string | null {
  if (!placedHas(b, part)) return "That part is not placed.";
  if (b.links.some((l) => l.given && (l.from === part || l.to === part)))
    return "That part holds a link you were given.";
  b.placed = b.placed.filter((p) => p.part !== part);
  b.links = b.links.filter((l) => l.from !== part && l.to !== part);
  return null;
}

export function linkParts(
  m: RefModel,
  b: Build,
  from: string,
  to: string,
  rel: unknown,
): BuildLink | string {
  if (!placedHas(b, from) || !placedHas(b, to))
    return "Place both parts first.";
  if (from === to) return "A part cannot link to itself.";
  if (!isVerb(rel) || !verbsFor(m.frame.kind).includes(rel))
    return "That verb is not one this frame uses.";
  if (b.links.some((l) => l.from === from && l.to === to && l.rel === rel))
    return "Those two are already linked that way.";
  const link: BuildLink = { id: `y${b.next++}`, from, to, rel };
  b.links.push(link);
  return link;
}

export function relinkParts(
  m: RefModel,
  b: Build,
  id: string,
  change: { rel?: unknown; reverse?: unknown },
): string | null {
  const l = b.links.find((x) => x.id === id);
  if (!l || l.given) return "That link is not yours to change.";
  if (change.rel !== undefined) {
    if (!isVerb(change.rel) || !verbsFor(m.frame.kind).includes(change.rel))
      return "That verb is not one this frame uses.";
    l.rel = change.rel;
  }
  if (change.reverse === true) [l.from, l.to] = [l.to, l.from];
  return null;
}

export function unlinkParts(b: Build, id: string): string | null {
  const l = b.links.find((x) => x.id === id);
  if (!l || l.given) return "That link is not yours to remove.";
  b.links = b.links.filter((x) => x !== l);
  return null;
}

// a key link you do not have yet, in the model's order: what hints aim at
export function openKey(m: RefModel, b: Build): RefLink | undefined {
  const have = (r: RefLink) => b.links.some((l) => sameLink(l, r));
  return m.links.find((r) => r.key && !r.argued && !have(r));
}

// The next hint rung on the first key link you do not have: where (one end),
// then Claude's question, then the link as a ghost with its verb hidden.
// Only after a first check. A rung whose text gave the link away is skipped.
export function nextHint(
  m: RefModel,
  b: Build,
): { link: string; rung: 1 | 2 | 3 } | string {
  if (!b.checks) return "Check once first; hints come after a first try.";
  const target = openKey(m, b);
  if (!target) return "Every key link is already there.";
  const used = b.hints.filter((h) => h.link === target.id).map((h) => h.rung);
  const rungs = ([1, 2, 3] as const).filter(
    (r) => !used.includes(r) && (r !== 2 || !!target.hint),
  );
  if (!rungs.length) return "No hints left on this link: Show one link.";
  return { link: target.id, rung: rungs[0] };
}

// Show one link: a key link you do not have, drawn for you and marked shown.
export function showOneLink(m: RefModel, b: Build): RefLink | string {
  const target = openKey(m, b);
  if (!target) return "Every key link is already there.";
  b.links.push({
    id: `y${b.next++}`,
    from: target.from,
    to: target.to,
    rel: target.rel,
    given: true,
  });
  for (const p of [target.from, target.to])
    if (!placedHas(b, p)) placePart(m, b, p);
  b.shown.push(target.id);
  return target;
}

// ---------------------------------------------------------------- credit

// how each key link came out of a rebuild: right at the first check by you;
// shown; wrong at the first check while sure; fixed later; never right
export function outcomes(
  m: RefModel,
  b: Build,
): Record<string, { how: How; sure?: Sure }> {
  const rightNow = new Set(
    m.links
      .filter((r) => b.links.some((l) => !l.given && sameLink(l, r)))
      .map((r) => r.id),
  );
  const out: Record<string, { how: How; sure?: Sure }> = {};
  const hinted = new Set(b.hints.map((h) => h.link));
  for (const r of m.links) {
    if (!r.key || r.argued) continue;
    const touchesHinted = (b.hinted ?? []).some(
      (p) => p === r.from || p === r.to,
    );
    if (b.shown.includes(r.id)) out[r.id] = { how: "shown" };
    else if (b.first?.[r.id] && !hinted.has(r.id) && !touchesHinted)
      out[r.id] = { how: "unaided" };
    else if (b.first && !b.first[r.id] && b.firstSure === "sure")
      out[r.id] = { how: "wrong", sure: "sure" };
    else if (rightNow.has(r.id)) out[r.id] = { how: "hinted" };
    else
      out[r.id] = {
        how: "wrong",
        ...(b.firstSure ? { sure: b.firstSure } : {}),
      };
  }
  return out;
}

// a whole build's credit: shown if anything was shown, hints if anything
// was helped, otherwise yours
export function creditOf(m: RefModel, b: Build, viaModel = false): Credit {
  const o = Object.values(outcomes(m, b));
  if (viaModel || o.some((x) => x.how === "shown")) return "shown";
  if (o.some((x) => x.how !== "unaided")) return "hints";
  return "you";
}

// ---------------------------------------------------------------- schedule

// The local calendar day of a time: a promotion counts once per day.
export const localDay = (t: number): number =>
  Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / DAY);

// One item per key link and one per what-if, made when a step is Built: box
// 1, due in a day.
export function newItems(m: RefModel, now: number): Item[] {
  const make = (ref: string, kind: Item["kind"]): Item => ({
    id: `${m.id}:${ref}`,
    model: m.id,
    kind,
    ref,
    box: 1,
    due: now + DAY,
    retired: false,
    made: now,
    log: [],
  });
  return [
    ...m.links.filter((l) => l.key && !l.argued).map((l) => make(l.id, "link")),
    ...(m.whatif ? [make("whatif", "whatif")] : []),
  ];
}

// An answer on an item. Unaided right moves it up a box, once a local day
// (and never on the day it was built); hinted keeps the box, due tomorrow;
// shown or wrong sends it back to box 1. Wrong while sure flags its
// refutation for the next check. It retires after unaided answers on 3
// different days, the last at box 3 or higher.
export function record(item: Item, how: How, now: number, sure?: Sure): Item {
  const day = localDay(now);
  const movedToday =
    localDay(item.made) === day ||
    item.log.some((e) => e.how === "unaided" && localDay(e.at) === day);
  item.log.push({ at: now, how, ...(sure ? { sure } : {}) });
  if (how === "unaided") {
    if (!movedToday) {
      item.box = Math.min(5, item.box + 1) as Item["box"];
      item.due = now + BOXES[item.box] * DAY;
    }
    // the day it was built is not one of the three
    const days = new Set(
      item.log
        .filter((e) => e.how === "unaided")
        .map((e) => localDay(e.at))
        .filter((d) => d !== localDay(item.made)),
    );
    if (days.size >= 3 && item.box >= 3) item.retired = true;
  } else if (how === "hinted") {
    item.due = now + DAY;
  } else {
    item.box = 1;
    item.due = now + DAY;
    if (how === "wrong" && sure === "sure") item.refute = true;
  }
  return item;
}

export const itemsOf = (s: LearnState, modelId: string): Item[] =>
  Object.values(s.items).filter((i) => i.model === modelId);

// A step's help on review: its weakest live item's box (0-1 → L1, 2 → L2,
// 3+ → L3), one lower after a quick rebuild that came out wrong.
export function helpFor(items: Item[], recallWrong = false): Help {
  const live = items.filter((i) => !i.retired);
  const low = live.length ? Math.min(...live.map((i) => i.box)) : 3;
  const h = low <= 1 ? 1 : low === 2 ? 2 : 3;
  return Math.max(0, recallWrong ? h - 1 : h) as Help;
}

// How many live items are due now, and when the next one falls due. Items of
// a step that is no longer on the path wait, uncounted.
export function dueOf(
  s: LearnState,
  live: ReadonlySet<string>,
  now: number,
): { now: number; next: number | null } {
  let count = 0;
  let next: number | null = null;
  for (const i of Object.values(s.items)) {
    const m = own(s.models, i.model);
    if (i.retired || !m || !live.has(m.step)) continue;
    if (i.due <= now) count++;
    else if (next === null || i.due < next) next = i.due;
  }
  return { now: count, next };
}

// Kept: every key-link item has been rebuilt unaided on a later day than the
// day it was built.
export function kept(items: Item[]): boolean {
  const links = items.filter((i) => i.kind === "link");
  return (
    links.length > 0 &&
    links.every((i) =>
      i.log.some(
        (e) => e.how === "unaided" && localDay(e.at) > localDay(i.made),
      ),
    )
  );
}

// In-session spacing: once step N+1 is built, step N asks for one quick
// rebuild; only once, ever.
export function markRecall(
  s: LearnState,
  path: readonly string[],
  built: string,
): string | null {
  const i = path.indexOf(built);
  if (i <= 0) return null;
  const prev = own(s.steps, path[i - 1]);
  if (!prev || prev.stage !== "built" || prev.recallDone || prev.recallDue)
    return null;
  prev.recallDue = true;
  return path[i - 1];
}

// Today, unaided: n of the key links reviewed since a time, by their latest answer.
export function unaidedSince(
  s: LearnState,
  since: number,
): { unaided: number; of: number } {
  let unaided = 0;
  let of = 0;
  for (const i of Object.values(s.items)) {
    if (i.kind !== "link") continue;
    const last = i.log.filter((e) => e.at >= since).at(-1);
    if (!last) continue;
    of++;
    if (last.how === "unaided") unaided++;
  }
  return { unaided, of };
}

// "Which idea is this?": one card per due step, its what-if question (or its
// new case's title), with the built steps' titles as choices. The server
// knows the answer, so it costs no call.
export function ideaCards(
  s: LearnState,
  due: readonly string[],
  built: readonly string[],
  seed: number,
): Card[] {
  if (built.length < 3) return [];
  const cards: Card[] = [];
  for (const step of due) {
    const m = own(s.models, own(s.stepModel, step) ?? "");
    const c = s.steps[step]?.caseModel
      ? own(s.models, s.steps[step].caseModel!)
      : undefined;
    const ask = m?.whatif?.ask || (c?.status === "ready" ? c.title : "");
    if (!ask) continue;
    const others = shuffled(
      built.filter((x) => x !== step),
      seed + cards.length,
    ).slice(0, 3);
    cards.push({
      id: `c${cards.length + 1}`,
      ask,
      choices: shuffled([step, ...others], seed + 7 * (cards.length + 1)),
      answer: step,
    });
  }
  return cards;
}

// ---------------------------------------------------------------- outline

// What Claude reads each move: the step being worked on in full (its
// reference, your build, the last check, the hints used), the other steps in
// one line each, so the prompt stays small.
export function outlineOf(
  s: LearnState,
  nodes: Record<string, MapNode>,
): string {
  const path = pathSteps(nodes);
  const title = (id: string) => own(nodes, id)?.title ?? id;
  const lines = [
    `LEARN, BUILD MODE: the learner sees each step's model once, then builds it back from memory; the server checks it. Level: ${s.level ?? "not chosen yet"}.`,
    "STEPS:",
  ];
  for (const p of path) {
    const st = own(s.steps, p.id);
    const m = own(s.models, own(s.stepModel, p.id) ?? "");
    lines.push(
      `${"  ".repeat(p.depth)}- [${p.id}] "${title(p.id)}" · ${
        m
          ? `model ${m.id} (${m.status}, ${m.parts.length} parts, ${m.links.length} links, frame ${m.frame.kind})`
          : "no model yet"
      }${st ? ` · ${st.stage} · help L${st.help}` : ""}`,
    );
  }
  const at = s.at && own(s.steps, s.at) ? s.at : undefined;
  const st = at ? s.steps[at] : undefined;
  const main = at ? own(s.models, own(s.stepModel, at) ?? "") : undefined;
  const m = st?.onCase && st.caseModel ? own(s.models, st.caseModel) : main;
  if (at && st && m) {
    lines.push(
      "",
      `CURRENT STEP [${at}] "${title(at)}" (the learner never sees this reference; name parts by their label in quotes, never by id):`,
      `  model ${m.id}${m.of ? ` (a new case of ${m.of})` : ""} · mode ${m.mode} · layer ${m.layer} · frame ${JSON.stringify(m.frame)}`,
      `  case: "${m.title}": ${m.case}`,
      "  parts:",
      ...m.parts.map(
        (p) =>
          `    [${p.id}] "${p.label}": ${p.role}${p.slot ? ` · slot ${p.slot.join(" | ")}` : ""}`,
      ),
      "  links:",
      ...m.links.map(
        (l) =>
          `    [${l.id}] ${linkWords(m, l)}${l.key ? " · KEY" : ""}${l.argued ? " · argued by the learner, accepted" : ""}${l.rubric ? ` · rubric: ${l.rubric}` : ""}`,
      ),
      ...(m.miscon.length
        ? [
            "  misconceptions:",
            ...m.miscon.map(
              (x) =>
                `    [${x.id}] ${x.claim}${x.link ? ` (as a link: ${linkWords(m, x.link)})` : ""}`,
            ),
          ]
        : []),
      ...(m.whatif ? [`  what if: ${m.whatif.ask}`] : []),
    );
    const b = own(s.builds, m.id);
    if (b) {
      lines.push(
        `  THEIR BUILD (help L${b.help}, ${HELP[b.help].name}): ${b.placed.length} of ${m.parts.length} parts placed`,
        ...b.links.map(
          (l) => `    ${linkWords(m, l)}${l.given ? " (given)" : ""}`,
        ),
      );
      if (b.last)
        lines.push(
          `  LAST CHECK: ${b.last.right} of ${b.last.total} right, ${b.last.reversed} reversed, ${b.last.family} near verb, ${b.last.miscon} misconception, ${b.last.extra} not in your model, ${b.last.missing} missing${b.last.pass ? " · passed" : ""}`,
        );
      if (b.hints.length || b.shown.length)
        lines.push(
          `  HELP USED: ${b.hints.length} hint(s)${b.shown.length ? `, ${b.shown.length} link(s) shown` : ""}`,
        );
    }
    if (st.why)
      lines.push(
        `  WHY so far: ${st.why.state} after ${st.why.tries} tr${st.why.tries === 1 ? "y" : "ies"}`,
      );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- the view

const partView = (p: Part): PartView => ({
  id: p.id,
  label: p.label,
  role: p.role,
});
const linkView = (l: {
  id: string;
  from: string;
  to: string;
  rel: Verb;
  given?: true;
}): LinkView => ({
  id: l.id,
  from: l.from,
  to: l.to,
  rel: l.rel,
  ...(l.given ? { given: true } : {}),
});

function stepView(
  s: LearnState,
  nodes: Record<string, MapNode>,
  p: PathStep,
  now: number,
): StepView {
  const node = nodes[p.id];
  const st = own(s.steps, p.id) ?? freshStep(s.level);
  const main = own(s.models, own(s.stepModel, p.id) ?? "");
  const caseM = st.caseModel ? own(s.models, st.caseModel) : undefined;
  const m = st.onCase && caseM?.status === "ready" ? caseM : main;
  const ready = m?.status === "ready";
  const items = main ? itemsOf(s, main.id) : [];
  const base: StepView = {
    step: p.id,
    title: node.title,
    depth: p.depth,
    parent: p.parent,
    model: m ? (m.status === "ready" ? "ready" : m.status) : "none",
    problems: m?.status === "broken" ? (m.problems ?? []) : [],
    stage: st.stage,
    help: st.help,
    mode: m?.mode ?? "build",
    layer: m?.layer ?? "behaviour",
    caseTitle: m?.title ?? "",
    case: m?.case ?? "",
    frame: m?.frame ?? { kind: "free" },
    verbs: verbsFor(m?.frame.kind ?? "free"),
    tray: [],
    trayCount: 0,
    worked: null,
    placed: [],
    links: [],
    check: null,
    checks: 0,
    sure: null,
    hints: [],
    canHint: false,
    typed: null,
    predict: null,
    why: null,
    whatif: null,
    onCase: !!st.onCase && caseM?.status === "ready",
    newCase: caseM ? caseM.status : "none",
    argued: [],
    rungs: {
      ...st.rungs,
      kept: kept(items) ? (st.rungs.kept ?? "you") : st.rungs.kept,
    },
    recallDue: !!st.recallDue,
    recall: !!st.recall,
    reviewing: !!st.reviewing,
    itemsDue: items.filter((i) => !i.retired && i.due <= now).length,
  };
  if (!m || !ready) return base;

  // the worked case: while you see it, or after Show the model; before you
  // predict, the link the predict question is about stays hidden
  if (st.stage === "see" || st.shownModel) {
    const hideLink =
      st.stage === "see" && !st.predicted && !st.shownModel
        ? m.predict?.hides
        : undefined;
    const hidden = hideLink
      ? (m.links.find((l) => l.id === hideLink)?.to ?? null)
      : null;
    base.worked = {
      parts: m.parts.map((x) =>
        x.id === hidden
          ? { id: x.id, label: "?", role: "" }
          : { ...partView(x), ...(x.slot ? { slot: x.slot[0] } : {}) },
      ),
      links: m.links
        .filter((l) => !l.argued && l.id !== hideLink)
        .map(linkView),
      hidden,
    };
  }
  if (st.stage === "see" && m.predict && !st.shownModel) {
    const pick = st.predicted?.pick ?? null;
    const choice = m.predict.choices.find((c) => c.text === pick);
    const right =
      pick === null ? null : normAnswer(pick) === normAnswer(m.predict.answer);
    base.predict = {
      ask: m.predict.ask,
      choices: m.predict.choices.map((c) => c.text),
      picked: pick,
      sure: st.predicted?.sure ?? null,
      right,
      refute:
        right === false && choice?.miscon
          ? (m.miscon.find((x) => x.id === choice.miscon)?.refute ?? null)
          : null,
    };
  }

  const b =
    own(s.builds, m.id) ??
    (st.stage === "build" ? startBuild(m, st.help) : undefined);
  if (b) {
    const label = (id: string) => m.parts.find((x) => x.id === id)!;
    base.placed = b.placed
      .filter((x) => isPart(m, x.part))
      .map((x) => ({
        ...partView(label(x.part)),
        x: x.x,
        y: x.y,
        ...(x.slot ? { slot: x.slot } : {}),
      }));
    base.links = b.links.map(linkView);
    base.check = b.last;
    base.checks = b.checks;
    base.sure = b.sure ?? null;
    const unplaced = shuffled(
      m.parts.filter((x) => !b.placed.some((y) => y.part === x.id)),
      seedOf(m.id),
    );
    base.trayCount = unplaced.length;
    // at L3 you type the names: the tray says only how many are left
    base.tray = b.help === 3 ? [] : unplaced.map(partView);
    base.typed = b.typed ?? null;
    base.argued = b.argued ?? [];
    base.hints = b.hints.flatMap((h): HintView[] => {
      const l = m.links.find((x) => x.id === h.link);
      if (!l) return [];
      if (h.rung === 1)
        return [
          { rung: 1 as const, text: `Look at "${label(l.from).label}".` },
        ];
      if (h.rung === 2)
        return l.hint ? [{ rung: 2 as const, text: l.hint }] : [];
      return [
        {
          rung: 3 as const,
          text: `A link from "${label(l.from).label}" to "${label(l.to).label}": which verb?`,
          from: l.from,
          to: l.to,
        },
      ];
    });
    base.canHint = st.stage === "build" && b.checks > 0 && !!openKey(m, b);
  }

  const why = st.whyLink
    ? main?.links.find((l) => l.id === st.whyLink)
    : undefined;
  if (main && why?.ask && (st.stage === "why" || st.stage === "built"))
    base.why = {
      ask: why.ask,
      link: {
        from: labelOf(main, why.from),
        to: labelOf(main, why.to),
        rel: why.rel,
      },
      state: st.why?.state ?? null,
      say: st.why?.say ?? "",
      tries: st.why?.tries ?? 0,
      pre: st.pre ?? "",
    };
  if (main?.whatif && st.stage === "built")
    base.whatif = {
      ask: main.whatif.ask,
      fails: labelOf(main, main.whatif.fails),
      result: st.whatif ? { ...st.whatif, why: main.whatif.why } : null,
    };
  return base;
}

function reviewView(
  s: LearnState,
  nodes: Record<string, MapNode>,
  live: ReadonlySet<string>,
): ReviewView | null {
  const r = s.review;
  if (!r) return null;
  const order = r.order.filter((id) => live.has(id));
  const today = unaidedSince(s, r.at);
  const items: ReviewView["items"] = [];
  for (const step of order) {
    if (s.steps[step]?.reviewing) continue;
    const m = own(s.models, own(s.stepModel, step) ?? "");
    if (!m) continue;
    for (const i of itemsOf(s, m.id)) {
      if (i.kind !== "link") continue;
      const now = i.log.filter((e) => e.at >= r.at).at(-1);
      if (!now) continue;
      const l = m.links.find((x) => x.id === i.ref);
      items.push({
        step,
        label: l ? `${labelOf(m, l.from)} → ${labelOf(m, l.to)}` : i.ref,
        last: i.log.filter((e) => e.at < r.at).at(-1)?.how ?? null,
        today: now.how,
      });
    }
  }
  const done = order.every((id) => !s.steps[id]?.reviewing);
  return {
    at: r.at,
    since: r.since,
    order,
    unaided: today.unaided,
    of: Math.max(r.items, today.of),
    items,
    cards: done
      ? r.cards.map((c) => ({
          id: c.id,
          ask: c.ask,
          choices: c.choices
            .filter((id) => own(nodes, id))
            .map((id) => ({ step: id, title: nodes[id].title })),
          picked: c.picked ?? null,
          right: c.picked ? c.picked === c.answer : null,
        }))
      : [],
  };
}

// All the browser sees of a build-mode map. Never the accept lists, learned
// names, rubrics, hints not asked for, reversed notes before a reversal,
// what a what-if affects, the predict answer or the misconception patterns;
// the worked links only while you see them.
export function viewOf(
  s: LearnState,
  nodes: Record<string, MapNode>,
  now: number,
  topic = false,
): LearnView {
  const path = pathSteps(nodes);
  const live = new Set(path.map((p) => p.id));
  return {
    mode: "build",
    now,
    level: s.level,
    steps: path.map((p) => stepView(s, nodes, p, now)),
    due: dueOf(s, live, now),
    review: reviewView(s, nodes, live),
    last: s.visits.at(-1) ?? null,
    topic,
  };
}

export const isSure = (v: unknown): v is Sure => SURES.includes(v as Sure);
