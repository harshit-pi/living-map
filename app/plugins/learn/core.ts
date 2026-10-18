// Learn's build mode, pure logic and no I/O: cleaning and checking the
// models Claude writes, grading what you build against them, the help each
// level gives, the review schedule, what Claude reads each move and what the
// browser sees. Time always comes in as `now`, so every rule here is tested
// without a clock.

import {
  ARGUABLE,
  familyOf,
  HELP,
  isVerb,
  LAYERS,
  LEVEL_HELP,
  MIXED_FROM,
  orderStops,
  placingIsAnswer,
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
  VERBS,
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
  // other verbs you argued for on this very link and Claude accepted: the
  // verbs are a closed list, and "prevents" said "cuts" as well as "lowers"
  also?: Verb[];
};
export type Miscon = {
  id: string;
  claim: string;
  refute: string;
  link?: { from: string; to: string; rel: Verb };
};
export type Predict = {
  ask: string;
  // a wrong choice carries a misconception, or a line on why it is not it
  choices: { text: string; miscon?: string; why?: string }[];
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
  // the verbs offered for this subject (verbsOf), out of the frame's own
  verbs?: Verb[];
  parts: Part[];
  links: RefLink[];
  miscon: Miscon[];
  predict?: Predict;
  whatif?: WhatIf;
  // shown only once it held together (validate); broken after the retry failed
  status: "writing" | "ready" | "broken";
  problems?: string[];
  // links cleaning dropped, and why, said in the retry when the model does
  // not hold together (a link dropped for its verb left its predict hiding
  // "a link that is not one", and the retry could not see why)
  dropped?: string[];
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
  // visit's help by one (`lowered`: this review's help was, which the step
  // says: the card's "less help" read false beside an L0 rebuild)
  recall?: boolean;
  recallWrong?: boolean;
  lowered?: boolean;
  // how the quick rebuild came out, once it passed (the card said nothing,
  // and the step went back to its old Why as if nothing had happened)
  recalled?: { credit: Credit; tries: number };
  // a review rebuild under way
  reviewing?: boolean;
  // Show the model is open: the worked case stays on screen
  shownModel?: boolean;
  // the build passed only through Show the model
  viaModel?: boolean;
  // a new case on this step, and whether you are building it now
  caseModel?: string;
  onCase?: boolean;
  whatif?: { found: string[]; missed: string[]; extra: string[] };
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
  // `n`: when the part came into its slot, the order it keeps there (a part
  // dropped into a box sorted by where it was dropped went to its top, and
  // moved the ones already in it)
  placed: { part: string; x: number; y: number; slot?: string; n?: number }[];
  links: BuildLink[];
  // a hint on a link, or on where a part sits ("place:<part id>"); a
  // first rung names the link's `to` end when you had already linked its
  // `from` end elsewhere
  hints: { link: string; rung: 1 | 2 | 3; end?: "to" }[];
  shown: string[];
  checks: number;
  last: CheckResult | null;
  // your build as it was at the last check (buildKey)
  checked?: string;
  sure?: Sure;
  // how each key link stood at the first check, and how sure you were then
  first?: Record<string, boolean>;
  firstSure?: Sure;
  // parts whose names a "did you mean" showed you: they count as hinted,
  // however you then place them (typing an offered name exactly was "by you")
  hinted?: string[];
  // key links a reply of Claude's named while you built: hinted too
  told?: string[];
  typed?: { text: string; suggest: string[] };
  // a link you argued for, waiting for Claude's verdict, and the verdicts
  argue?: { from: string; to: string; rel: Verb; said: string };
  argued?: {
    from: string;
    to: string;
    rel: Verb;
    holds: boolean;
    say: string;
    // accepted as another verb for a link of Claude's own
    pair?: true;
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

// A field of the model's, as the learner reads it. The map's own rule
// marks an unsure fact "⚠️ verify", which is for a map you decide on: on a
// part's role you learn by heart, a case line, a refutation or a verdict it
// read as part of the fact ("Defence budget, a large share of output ⚠️
// verify").
export const cleanText = (v: unknown, n: number): string =>
  str(v, n)
    .replace(/\s*\u26a0\ufe0f?\s*verify\b/gi, "")
    .trim();
const clean = cleanText;
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
  // A role that names another part says what it links to, so it is left
  // out (the card shows the label alone). Refused instead, a new case was
  // sent back twice for "the outcome of one test run" beside a part "Test
  // run", and broke: three paid moves for one plain phrase.
  // A word of another part's label that no other label has names that part
  // too: "council of landowners that refused veterans settlements" on the
  // Senate said the key link "Senate" prevents "Veteran land grants".
  for (const a of parts)
    if (parts.some((b) => b !== a && roleNames(a, b, parts))) a.role = "";
  const of = safe(op?.of);
  const allowed = verbsFor(frame.kind);
  const verbs = [
    ...new Set(list(op?.verbs, 17).filter((v) => allowed.includes(v))),
  ] as Verb[];
  return {
    id: safe(op?.id) || `m-${step}`,
    step,
    ...(of ? { of } : {}),
    mode: op?.mode === "play" ? "play" : "build",
    layer: LAYERS.includes(op?.layer) ? op.layer : "behaviour",
    title: clean(op?.title, 80),
    case: clean(op?.case, 160),
    frame,
    ...(verbs.length ? { verbs } : {}),
    parts,
    links: [],
    miscon: [],
    status: "writing",
  };
}

// Whether part a's role names part b: b's whole label, or a word of it that
// is b's alone (no other label, a's own included, has it).
function roleNames(a: Part, b: Part, parts: readonly Part[]): boolean {
  if (!a.role.trim()) return false;
  if (phrase(a.role).includes(phrase(b.label))) return true;
  const said = new Set(wordsOf(a.role).map(root));
  const own = (p: Part) =>
    wordsOf(p.label)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map(root);
  const elsewhere = new Set(parts.filter((p) => p !== b).flatMap(own));
  return own(b).some((w) => !elsewhere.has(w) && said.has(w));
}

const isPart = (m: RefModel, id: string) => m.parts.some((p) => p.id === id);

// The verbs a step offers. The frame's whole list mixes subjects (a history
// map was offered "reads" and "calls"), so Claude names the ones that fit;
// the ones its links and misconceptions use are always in, and a short list
// is filled from the same families to six, so it never lists only the
// answers. A model that named none offers the frame's list.
export function verbsOf(m: RefModel): Verb[] {
  const frame = verbsFor(m.frame.kind);
  if (!m.verbs?.length) return frame;
  const keep = new Set<Verb>([
    ...m.verbs,
    ...m.links.map((l) => l.rel),
    ...m.miscon.flatMap((x) => (x.link ? [x.link.rel] : [])),
  ]);
  const fams = new Set([...keep].map(familyOf));
  for (const v of frame) {
    if (keep.size >= 6) break;
    if (fams.has(familyOf(v))) keep.add(v);
  }
  return frame.filter((v) => keep.has(v));
}

// "A contains B" says what "B part of A" says: links are compared in one
// direction, so the inverse verb on the reversed pair is the same link and
// not one that points the wrong way.
const INVERSE: Partial<Record<Verb, Verb>> = {
  contains: "part of",
  "part of": "contains",
};
type Triple = { from: string; to: string; rel: Verb };
export const canon = (l: Triple): Triple =>
  l.rel === "contains"
    ? { from: l.to, to: l.from, rel: "part of" }
    : { from: l.from, to: l.to, rel: l.rel };

// One link, whichever way it is said; a reference link's argued-for verbs
// (`also`) say it too, wherever a build is held against it.
export function sameLink(
  a: Triple & { also?: Verb[] },
  b: Triple & { also?: Verb[] },
): boolean {
  const eq = (p: Triple, q: Triple) => {
    const x = canon(p);
    const y = canon(q);
    return x.from === y.from && x.to === y.to && x.rel === y.rel;
  };
  return (
    eq(a, b) ||
    (a.also ?? []).some((rel) => eq({ ...a, rel }, b)) ||
    (b.also ?? []).some((rel) => eq(a, { ...b, rel }))
  );
}

// Which way a verb of the cause family moves what it acts on: up (it
// enables, activates or raises it) or down (it prevents or lowers it).
// "causes" says only that it happens, so it has no sense.
const SENSE: Partial<Record<Verb, 1 | -1>> = {
  enables: 1,
  activates: 1,
  raises: 1,
  prevents: -1,
  lowers: -1,
};
// two verbs that say the effect goes the same way
export const sameSense = (a: Verb, b: Verb): boolean =>
  !!SENSE[a] && SENSE[a] === SENSE[b];

// the same two parts the same way round, whatever the verb
export function samePair(a: Triple, b: Triple): boolean {
  const x = canon(a);
  const y = canon(b);
  return x.from === y.from && x.to === y.to;
}

// The misconception a link of yours draws: its own link exactly, or, when
// Claude's model has nothing on those two parts either way, its two parts
// the same way round with any verb. Only the exact verb counted: the mix-up
// a learner had just picked with "sure" in the predict ("inflation takes
// money out of your account") was "not in Claude's model, and not wrong"
// drawn with "prevents" rather than "makes".
//
// Nor only the exact verb when the two say the same way the effect goes
// (sameSense): "Glasnost enables Party legitimacy" is the mix-up "Glasnost
// raises Party legitimacy", where Claude's link on that pair lowers it, and
// it was marked "~ the right pair with another verb", with no refutation.
export function misconOf(m: RefModel, l: Triple): Miscon | undefined {
  const exact = m.miscon.find((y) => y.link && sameLink(y.link, l));
  if (exact) return exact;
  const says = m.miscon.find(
    (y) =>
      y.link &&
      samePair(y.link, l) &&
      sameSense(y.link.rel, l.rel) &&
      !m.links.some((r) => samePair(r, l) && sameSense(r.rel, l.rel)),
  );
  if (says) return says;
  const flip = { from: l.to, to: l.from, rel: l.rel };
  if (m.links.some((r) => samePair(r, l) || samePair(r, flip)))
    return undefined;
  return m.miscon.find((y) => y.link && samePair(y.link, l));
}

// A link's ends must be parts of its model and its verb one the frame
// allows; anything else is dropped. A link sent again by id replaces it.
export function addLinks(m: RefModel, raw: Raw): number {
  const allowed = verbsFor(m.frame.kind);
  let n = 0;
  const drop = (why: string) => {
    m.dropped = [...(m.dropped ?? []), why].slice(-6);
  };
  for (const l of list(raw, 12)) {
    const id = safe(l?.id);
    const from = safe(l?.from);
    const to = safe(l?.to);
    const rel = l?.rel;
    if (!id) continue;
    if (!isPart(m, from) || !isPart(m, to) || from === to) {
      drop(
        `the link "${id}" was dropped: its ends must be two different parts of the model`,
      );
      continue;
    }
    if (!isVerb(rel) || !allowed.includes(rel)) {
      drop(
        `the link "${id}" was dropped: a ${m.frame.kind} frame does not take the verb "${str(rel, 20)}" (it takes ${allowed.join(", ")})`,
      );
      continue;
    }
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
      const why = clean(c?.why, 160);
      return text
        ? { text, ...(miscon ? { miscon } : {}), ...(why ? { why } : {}) }
        : null;
    })
    .filter((c): c is Predict["choices"][number] => !!c);
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
    if (saysVerb(t, l.rel)) out.push(l.id);
  }
  return out;
}

// the verb or its inverse ("contains" says "part of" the other way round)
const saysVerb = (t: string, rel: Verb) =>
  [rel, INVERSE[rel]].some((v) => v && t.includes(` ${STEMS[v]}`));

// The key links a text says in other words: most of each end's own words
// and the verb ("Take the cheapest town, then try its roads" says "Take
// cheapest town" then "Try each road"). Looser than givesAway, so it only
// trims what is read before a build (a step's summary), never refuses a model.
export function paraphrases(m: RefModel, text: string): string[] {
  const t = phrase(text);
  const said = new Set(wordsOf(text).map(stem));
  const most = (label: string) => {
    const w = wordsOf(label)
      .filter((x) => x.length >= 3 && !STOP.has(x))
      .map(stem);
    return (
      w.length > 0 &&
      w.filter((x) => said.has(x)).length >= Math.ceil(w.length / 2)
    );
  };
  return m.links
    .filter(
      (l) =>
        l.key &&
        most(labelOf(m, l.from)) &&
        most(labelOf(m, l.to)) &&
        saysVerb(t, l.rel),
    )
    .map((l) => l.id);
}

// The key links a text names with both their ends, in any words and with
// any verb: each end's own words are all there, or most of them with one
// no other part's label has ("cell" alone is not "Helper T cell"); each
// word said once stands for one end only ("Helper T cell" is not also "B
// cell"; "the B cell becomes a Memory B cell" names both). Used on what
// Claude writes while you build (Explain, a thread, the message box), which
// must not say what links to what.
export function namedKeys(m: RefModel, text: string): string[] {
  const said = new Map<string, number>();
  for (const w of wordsOf(text).map(root)) said.set(w, (said.get(w) ?? 0) + 1);
  const keyWords = (label: string) => [
    ...new Set(
      wordsOf(label)
        .filter((x) => x.length >= 3 && !STOP.has(x))
        .map(root),
    ),
  ];
  const uses = new Map<string, number>();
  for (const p of m.parts)
    for (const w of keyWords(p.label)) uses.set(w, (uses.get(w) ?? 0) + 1);
  // the label is there in the words left: they are taken for it
  const take = (left: Map<string, number>, w: string[]) => {
    const got = w.filter((x) => (left.get(x) ?? 0) > 0);
    const enough =
      w.length > 0 &&
      (got.length === w.length ||
        (got.length * 2 >= w.length && got.some((x) => uses.get(x) === 1)));
    if (!enough) return false;
    for (const x of got) left.set(x, left.get(x)! - 1);
    return true;
  };
  return m.links
    .filter((l) => {
      if (!l.key || l.argued) return false;
      const a = keyWords(labelOf(m, l.from));
      const b = keyWords(labelOf(m, l.to));
      // the longer label first, so its words are not taken by the shorter
      const [x, y] = a.length >= b.length ? [a, b] : [b, a];
      const left = new Map(said);
      return take(left, x) && take(left, y);
    })
    .map((l) => l.id);
}

// the windows a text is read in: its lines, or the sentences of a long one
const windows = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((line) =>
      line.length > 300 ? line.split(/(?<=[.!?])\s+/) : [line],
    );

// Every key link a text names, read window by window.
export const keysIn = (m: RefModel, text: string): string[] => [
  ...new Set(windows(text).flatMap((w) => namedKeys(m, w))),
];

// What Claude writes onto the map while you build a step, with every line
// (or sentence of a long one) that names a key link left out: an Explain
// said "Head pointer: stored in the bucket. It points to the first entry",
// one of the links you were rebuilding, and it stayed in the panel.
// A line about one part ("Merge: …", "- **Merge** — …") keeps its part's
// name and says why the rest is out: an Explain of one line per part
// lost "Merge" with no word, and read as broken. On an axis the order is
// what you build, so a text that lists its parts in order has them put out
// of it (unorder).
export function redactLinks(m: RefModel, text: string): string {
  if (!keysIn(m, text).length) return unorder(m, text);
  const byLength = [...m.parts].sort((a, b) => b.label.length - a.label.length);
  const leftOut = (line: string): string => {
    const lead = /^(\s*(?:[-*•]|\d+[.)])?\s*)/.exec(line)![1];
    const rest = line
      .slice(lead.length)
      .replace(/^[*_"“'‘]+/, "")
      .toLowerCase();
    const p = byLength.find((x) => {
      const l = x.label.toLowerCase();
      return (
        rest.startsWith(l) && /^[*_"”'’]*\s*[:—–-]/.test(rest.slice(l.length))
      );
    });
    return p
      ? `${lead}"${p.label}": left out here, as it said what this part links to.`
      : "";
  };
  const lines = text.split("\n").map((line) =>
    line.length > 300
      ? line
          .split(/(?<=[.!?])\s+/)
          .filter((x) => !namedKeys(m, x).length)
          .join(" ")
      : namedKeys(m, line).length
        ? leftOut(line)
        : line,
  );
  const kept = unorder(
    m,
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
  return `${kept}${kept ? "\n\n" : ""}_What links to what is left out while you build this step._`;
}

// A text that tells an axis's order (tellsOrder), put out of it: an Explain
// during a play step listed its five subgoals as bullets in exactly the
// order of the ticks, and no line of it named a link. A line that tells the
// order on its own is left out; the list's items (each with the lines
// indented under it) lose their numbers and are sorted by their words, or
// turned from there until the text no longer tells it; failing that, every
// line that names a part is left out. Any other text comes back as it was.
export function unorder(m: RefModel, text: string): string {
  if (!tellsOrder(m, text)) return text;
  const LEAD = /^\s*(?:[-*•]|\d+[.)])\s+/;
  const names = (t: string) => m.parts.some((p) => mentions(t, p.label, m));
  // the text as blocks: a list item with what is indented under it, or a line
  const blocks: { item: boolean; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const indented = /^\s{2,}\S/.test(line);
    if (LEAD.test(line) && !indented)
      blocks.push({ item: true, lines: [line] });
    else if (indented && blocks.at(-1)?.item) blocks.at(-1)!.lines.push(line);
    else blocks.push({ item: false, lines: [line] });
  }
  const kept = blocks.filter((b) => !tellsOrder(m, b.lines.join("\n")));
  const items = kept.filter((b) => b.item && names(b.lines.join(" ")));
  const sorted = [...items].sort((a, b) =>
    a.lines[0].replace(LEAD, "").localeCompare(b.lines[0].replace(LEAD, "")),
  );
  const joined = (xs: string[]) =>
    xs
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const laid = (order: typeof items) => {
    let k = 0;
    return kept.flatMap((b) => {
      const at = b.item && items.includes(b) ? order[k++] : b;
      return at.item
        ? [at.lines[0].replace(LEAD, "- "), ...at.lines.slice(1)]
        : at.lines;
    });
  };
  let out = laid(sorted);
  for (let r = 1; r < sorted.length && tellsOrder(m, joined(out)); r++)
    out = laid([...sorted.slice(r), ...sorted.slice(0, r)]);
  const said = joined(
    tellsOrder(m, joined(out)) ? out.filter((line) => !names(line)) : out,
  );
  return `${said}${said ? "\n\n" : ""}_The parts are not in their order here: that order is what you build._`;
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
  // why a link the rules above count on is missing
  if (p.length && m.dropped?.length) p.push(...m.dropped);
  return p;
}

// the part of a summary before its first comma, colon, dash or "because"
export const firstClause = (s: string): string =>
  s.split(/[,;:(—–]| - | because | so that | which /)[0].trim();

// The part the worked case draws as "?" while the predict is open: the end
// of its link that the answer names, in its own words or the label's. Picked
// by the exact label alone, "Reaching a one-item list" hid the other end
// ("Split"), and the part the answer named sat on screen beside the question.
export function hiddenEnd(m: RefModel): string | null {
  const l = m.predict && m.links.find((x) => x.id === m.predict!.hides);
  if (!l) return null;
  const answer = m.predict!.answer;
  const exact = (id: string) =>
    normAnswer(labelOf(m, id)) === normAnswer(answer);
  const names = (id: string) =>
    exact(id) ||
    namesAll(answer, labelOf(m, id)) ||
    namesAll(labelOf(m, id), answer);
  if (exact(l.from)) return l.from;
  if (exact(l.to)) return l.to;
  return names(l.from) && !names(l.to) ? l.from : l.to;
}

// Whether a part left on screen while the predict is open names its
// answer: "ATP synthase makes ?" answered "what carries the energy… ATP?".
export function predictTold(m: RefModel): boolean {
  if (!m.predict?.answer.trim()) return false;
  const hidden = hiddenEnd(m);
  return m.parts.some(
    (p) => p.id !== hidden && namesAll(p.label, m.predict!.answer),
  );
}

// The wrong choices that are not parts on screen while the predict is open.
// One part is drawn as "?": a choice that is another part's label is ruled
// out by looking ("Which part takes it off the list?" offered "Round-robin
// picker" and "DNS record", both on the canvas, so the one missing from it
// was the answer, on every step of the map).
export function predictChoices(m: RefModel): Predict["choices"] {
  const p = m.predict;
  if (!p) return [];
  const hidden = hiddenEnd(m);
  // the label itself: "More antibody" is a claim about the part "Antibody",
  // not the part, and stays
  const same = (a: string, b: string) => normAnswer(a) === normAnswer(b);
  return p.choices.filter(
    (c) =>
      same(c.text, p.answer) ||
      !m.parts.some((x) => x.id !== hidden && same(x.label, c.text)),
  );
}

// The predict a step asks, unless a part on screen beside it names its
// answer, or the parts on screen rule out every wrong choice: a model
// settled before that was checked keeps it on disk, and it is not asked (nor
// waited for by Hide it). Its choices are the ones not on screen.
export function livePredict(m: RefModel): Predict | undefined {
  if (!m.predict || predictTold(m)) return undefined;
  const choices = predictChoices(m);
  return choices.length >= 2 ? { ...m.predict, choices } : undefined;
}

// Take giveaways out of what the learner reads before they build: a hint that
// gives a key link away drops its rung; a summary is cut to its first clause
// (or emptied); a predict that gives its answer away is dropped, in its own
// question or in a part's label left on screen beside it.
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
    if (
      givesAway(m, m.predict.ask).length ||
      inStep ||
      predictTold(m) ||
      !livePredict(m)
    ) {
      delete m.predict;
      predict = true;
    } else m.predict.choices = predictChoices(m);
  }
  let summary: string | null = null;
  const leaks = (t: string) =>
    givesAway(m, t).length > 0 ||
    paraphrases(m, t).length > 0 ||
    tellsOrder(m, t);
  if (step.summary && leaks(step.summary)) {
    const cut = firstClause(step.summary);
    summary = leaks(cut) ? "" : cut;
  }
  return { summary, hints, predict };
}

// Whether a text lists two or more of an axis's parts in their order: on an
// axis the order is what you build, and a play step's summary "Play one
// round: pick a middle, compare, shrink the window" was its ticks 2 to 4.
// Read clause by clause, each part where it is first named.
export function tellsOrder(m: RefModel, text: string): boolean {
  if (!orderStops(m.frame)) return false;
  const seen: number[] = [];
  for (const clause of text.split(/[,;:.!?→]+|\bthen\b|\band\b/i)) {
    m.parts.forEach((p, i) => {
      const r = rankOf(m, p, i);
      if (!seen.includes(r) && mentions(clause, p.label, m)) seen.push(r);
    });
  }
  // most of them in order is the order: an opening line that named the
  // second subgoal, then the five in order, read as out of order
  const run = seen.map(() => 1);
  for (let i = 0; i < seen.length; i++)
    for (let j = 0; j < i; j++)
      if (seen[j] < seen[i]) run[i] = Math.max(run[i], run[j] + 1);
  return (
    seen.length >= 2 &&
    Math.max(...run) >= Math.max(2, Math.ceil(seen.length * 0.75))
  );
}

// ---------------------------------------------------------------- grading

// Your build against the reference (and the links you argued for). Only the
// key links decide a pass, and 70% of the rest; at L0 and in a quick rebuild
// only the key links count. A link Claude does not have is never wrong. On
// an axis the order is the model (a play step's subgoals), so every placed
// part must sit on a tick, in order: a timeline scrambled five ways passed
// "built by you" on its links alone.
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
    // a second copy of a right link (a build saved before relink merged
    // them) is right, and counted once: graded as a near verb, the same
    // verb was marked "~"
    if (exact.has(l.id) || refs.some((r) => sameLink(r, l))) {
      marks.push({ link: l.id, mark: "right" });
      continue;
    }
    const x = misconOf(m, l);
    if (x) {
      miscon++;
      marks.push({ link: l.id, mark: "miscon", refute: x.refute });
      continue;
    }
    // compared one way round, so "contains" is "part of" reversed
    const c = canon(l);
    const rev = refs.find((r) => {
      const cr = canon(r);
      return (
        cr.from === c.to &&
        cr.to === c.from &&
        familyOf(cr.rel) === familyOf(c.rel)
      );
    });
    if (rev) {
      reversed++;
      touched.add(rev.id);
      // Claude writes no line per link for when it is drawn backwards: the
      // way the link runs says it (a model that has its own line keeps it)
      marks.push({
        link: l.id,
        mark: "reversed",
        note: rev.reversed ?? `It runs the other way: ${linkWords(m, rev)}.`,
      });
      continue;
    }
    // the right pair, the right way round, with another verb: a near verb
    // from its family, or one from another ("One list runs out" then "Copy
    // the leftovers" where the model has enables). Marked "?", it read as a
    // pair Claude's model does not have, and sent you away from it.
    const fam = refs.find((r) => {
      const cr = canon(r);
      return cr.from === c.from && cr.to === c.to;
    });
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
  // a link you argued for, Claude accepted and you drew is one of the
  // reference's other links, right: the headline counted it and the pass
  // did not ("6 of 8 links ✓" beside "you have 2")
  const arguedGot = refs.filter((r) => r.argued && right.has(r.id)).length;
  const restAll = rest.length + (keyOnly ? 0 : arguedGot);
  const restGot = rest.filter(got).length + (keyOnly ? 0 : arguedGot);
  // the other links a pass needs: 70% of them, rounded up
  const restNeed = keyOnly ? 0 : Math.ceil(restAll * PASS_SHARE - 1e-9);
  const where = placement(m, b);
  const ordered =
    where.stray === 0 &&
    (!orderStops(m.frame) || (where.outOfOrder === 0 && where.loose === 0));
  const pass =
    keys.length > 0 && keys.every(got) && restGot >= restNeed && ordered;
  const half = counted.filter((r) => halves.has(r.id) && !got(r)).length;
  const rightN = counted.filter((r) => right.has(r.id)).length;
  return {
    at: now,
    help: b.help,
    keyOnly,
    total: counted.length,
    right: rightN,
    // links you argued for that Claude accepted, drawn: right, on top of total
    argued: arguedGot,
    rest: keyOnly ? 0 : restAll,
    restGot: keyOnly ? 0 : restGot,
    restNeed,
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
    slots: where.slots,
    outOfOrder: where.outOfOrder,
    loose: where.loose,
    refutes,
    pass,
  };
}

// Lanes, boxes and sort: is each part placed in a slot one of its slots?
// Axis: how many pairs of parts on its ticks sit in the wrong order (two on
// one tick that the model has apart count too). A part placed outside the
// frame is loose: not placed yet, which is not the wrong slot. `stray`: the
// loose parts the model has a slot for, which stop a pass on every frame (a
// sort step passed with six of its eight explanations in no column: sorting
// them is the step).
export function placement(
  m: RefModel,
  b: Build,
): {
  slots: { part: string; ok: boolean }[];
  outOfOrder: number;
  loose: number;
  stray: number;
} {
  const ref = new Map(m.parts.map((p, i) => [p.id, { p, i }]));
  const valid = slotsOf(m.frame);
  const placed = b.placed.filter((x) => ref.has(x.part));
  const inFrame = placed.filter((x) => !!x.slot && valid.includes(x.slot));
  const loose = valid.length ? placed.length - inFrame.length : 0;
  const stray = valid.length
    ? placed.filter(
        (x) => !inFrame.includes(x) && !!ref.get(x.part)!.p.slot?.length,
      ).length
    : 0;
  if (m.frame.kind === "axis") {
    const ticks = m.frame.ticks;
    const at = (x: (typeof placed)[number]) => ticks.indexOf(x.slot!);
    let out = 0;
    for (const a of inFrame)
      for (const c of inFrame) {
        const ra = ref.get(a.part)!;
        const rc = ref.get(c.part)!;
        if (rankOf(m, ra.p, ra.i) < rankOf(m, rc.p, rc.i) && at(a) >= at(c))
          out++;
      }
    return { slots: [], outOfOrder: out, loose, stray };
  }
  if (m.frame.kind === "free")
    return { slots: [], outOfOrder: 0, loose: 0, stray: 0 };
  return {
    slots: inFrame
      .filter((x) => ref.get(x.part)?.p.slot?.length)
      .map((x) => ({
        part: x.part,
        ok: ref.get(x.part)!.p.slot!.includes(x.slot!),
      })),
    outOfOrder: 0,
    loose,
    stray,
  };
}

// a part's place in an axis's order: its own tick, or its place in the model
const rankOf = (m: RefModel, p: Part, i: number) => {
  const ticks = m.frame.kind === "axis" ? m.frame.ticks : [];
  const t = p.slot ? ticks.indexOf(p.slot[0]) : -1;
  return t >= 0 ? t : i;
};

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

// the slips of spelling a name takes: none under 5 letters, one up to 11,
// two from 12 ("presidnt sign" for "President signs" is a recalled name,
// and costing it a hint on both its key links was a lot for a typo)
const slips = (n: string) => (n.length >= 12 ? 2 : n.length >= 5 ? 1 : 0);

// Whether a typed name is close enough to a name to offer it as "did you
// mean": two letters in five off the whole name, or a slip or two off its
// start ("memry b" for "Memory B cell"). "qqq" offered "Antibody? B cell?
// Helper T cell?", three of the names L3 is there to test, for nothing.
function near(n: string, t: string): boolean {
  if (distance(n, t) <= Math.max(2, Math.floor(n.length * 0.4))) return true;
  if (t.length < 3) return false;
  const off = Math.floor(t.length * 0.3);
  return [t.length - 1, t.length, t.length + 1].some(
    (k) => distance(n.slice(0, k), t) <= off,
  );
}

// A part name typed at L3: Claude's accept list and the names you confirmed,
// then a slip or two of spelling (the nearest part, when only one is that
// near); otherwise up to 3 close labels as "did you mean", and none when
// nothing is close. Parts already on the canvas are never offered again.
export function matchPart(
  m: RefModel,
  typed: string,
  placed: readonly string[] = [],
): { part: string } | { suggest: string[] } {
  const t = normAnswer(typed);
  if (!t) return { suggest: [] };
  for (const p of m.parts) if (namesOf(p).includes(t)) return { part: p.id };
  const open = m.parts.filter((p) => !placed.includes(p.id));
  const close = open
    .map((p) => ({
      id: p.id,
      label: p.label,
      d: Math.min(...namesOf(p).map((n) => distance(n, t))),
      fits: namesOf(p).some((n) => distance(n, t) <= slips(n)),
      near: namesOf(p).some((n) => near(n, t)),
    }))
    .sort((a, b) => a.d - b.d || a.label.localeCompare(b.label));
  const fit = close.filter((x) => x.fits);
  if (fit.length && (fit.length === 1 || fit[0].d < fit[1].d))
    return { part: fit[0].id };
  return {
    suggest: close
      .filter((x) => x.near)
      .slice(0, 3)
      .map((x) => x.label),
  };
}

// The parts a "did you mean" names are shown to you: each counts as hinted
// from then on, picked from the list or typed after it.
export function revealNames(m: RefModel, b: Build, labels: string[]): void {
  const ids = m.parts.filter((p) => labels.includes(p.label)).map((p) => p.id);
  if (ids.length) b.hinted = [...new Set([...(b.hinted ?? []), ...ids])];
}

// ---------------------------------------------------------------- what if, why, new case

export function whatIf(
  m: RefModel,
  clicked: string[],
): { found: string[]; missed: string[]; extra: string[] } {
  const affected = new Set(m.whatif?.affected ?? []);
  const picked = [...new Set(clicked)].filter((id) => isPart(m, id));
  return {
    found: picked.filter((id) => affected.has(id)),
    // named once you have tried: the try is logged, so this is feedback now
    missed: [...affected].filter((id) => !picked.includes(id)),
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
// a looser stem, for whether a text names a part: "signed" and "signs" are
// both "sign"
const root = (w: string) =>
  w.length > 4 ? w.replace(/(ing|ed|es|e|s)$/, "") : w;

// Before a Why reaches Claude: too short, or only the labels, roles and
// link verbs said back, is refused here. Neither is a verdict, and neither
// costs a call. The verbs count as copied: "dog sends to Bucket 3" is the
// link read off the canvas, and it went to Claude as a paid move.
export function whyPrecheck(text: string, m: RefModel): string | null {
  const words = wordsOf(text);
  if (words.length < 5) return "Say a little more.";
  const content = words.filter((w) => w.length >= 3 && !STOP.has(w)).map(stem);
  const seen = new Set(
    [...m.parts.map((p) => `${p.label} ${p.role}`), ...VERBS]
      .flatMap(wordsOf)
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

// The graph a case's text draws, when it names one: "A–B 4, A–C 1" gives the
// edges A–B and A–C. An end is a short name with a capital or a digit after
// a letter ("A", "R1", "NYC"), so "OSPF-style" and "days 0-14" are not edges.
export function caseEdges(text: string): [string, string][] {
  const out = new Map<string, [string, string]>();
  for (const x of text.matchAll(
    /(?<![A-Za-z0-9])([A-Z][A-Za-z0-9]{0,3})\s*(?:–|—|-|→|->)\s*([A-Z][A-Za-z0-9]{0,3})(?![A-Za-z0-9])/g,
  )) {
    const [a, b] = [x[1], x[2]].sort();
    if (a !== b) out.set(`${a}|${b}`, [a, b]);
  }
  return [...out.values()];
}

// Whether two small undirected graphs are the same graph under new names.
export function sameGraph(
  a: [string, string][],
  b: [string, string][],
): boolean {
  const adj = (es: [string, string][]) => {
    const g = new Map<string, Set<string>>();
    for (const [x, y] of es) {
      if (!g.has(x)) g.set(x, new Set());
      if (!g.has(y)) g.set(y, new Set());
      g.get(x)!.add(y);
      g.get(y)!.add(x);
    }
    return g;
  };
  const ga = adj(a);
  const gb = adj(b);
  if (a.length !== b.length || ga.size !== gb.size) return false;
  const deg = (g: Map<string, Set<string>>) =>
    [...g.values()]
      .map((s) => s.size)
      .sort()
      .join();
  if (deg(ga) !== deg(gb)) return false;
  const na = [...ga.keys()];
  const map = new Map<string, string>();
  const used = new Set<string>();
  const fits = (i: number): boolean => {
    if (i === na.length) return true;
    const x = na[i];
    for (const y of gb.keys()) {
      if (used.has(y) || ga.get(x)!.size !== gb.get(y)!.size) continue;
      // every neighbour already mapped must be a neighbour here too
      if (
        [...ga.get(x)!].some((n) => map.has(n) && !gb.get(y)!.has(map.get(n)!))
      )
        continue;
      map.set(x, y);
      used.add(y);
      if (fits(i + 1)) return true;
      map.delete(x);
      used.delete(y);
    }
    return false;
  };
  return fits(0);
}

// Whether two models are one model under new labels: as many parts, and a
// way to match them part for part so every link (its ends, its direction,
// its verb, whether it is key) has its twin. The parts and links are few
// (8 and 10 at most), so trying the matches is quick.
export function sameModel(a: RefModel, b: RefModel): boolean {
  const la = a.links
    .filter((l) => !l.argued)
    .map((l) => ({ ...canon(l), key: l.key }));
  const lb = b.links
    .filter((l) => !l.argued)
    .map((l) => ({ ...canon(l), key: l.key }));
  if (a.parts.length !== b.parts.length || la.length !== lb.length)
    return false;
  const sig = (ls: typeof la, id: string) =>
    ls
      .flatMap((l) => [
        l.from === id ? `>${l.rel}${l.key}` : "",
        l.to === id ? `<${l.rel}${l.key}` : "",
      ])
      .filter(Boolean)
      .sort()
      .join();
  const twin = new Set(lb.map((l) => `${l.from}|${l.to}|${l.rel}|${l.key}`));
  const pa = a.parts.map((p) => p.id);
  const map = new Map<string, string>();
  const used = new Set<string>();
  const fits = (i: number): boolean => {
    if (i === pa.length)
      return la.every((l) =>
        twin.has(`${map.get(l.from)}|${map.get(l.to)}|${l.rel}|${l.key}`),
      );
    const x = pa[i];
    for (const y of b.parts.map((p) => p.id)) {
      if (used.has(y) || sig(la, x) !== sig(lb, y)) continue;
      map.set(x, y);
      used.add(y);
      if (fits(i + 1)) return true;
      map.delete(x);
      used.delete(y);
    }
    return false;
  };
  return fits(0);
}

// How much of model `a` model `b` keeps under new names: the best way to
// match a's parts to b's that keeps every key link of a (its ends, its
// direction, its verb, onto a key link of b), and how many of a's other
// links that match keeps too; null when no match keeps the key links. The
// parts are few (8 at most), so trying the matches is quick.
export function renamedLinks(a: RefModel, b: RefModel): number | null {
  const ls = (m: RefModel) =>
    m.links.filter((l) => !l.argued).map((l) => ({ ...canon(l), key: l.key }));
  const la = ls(a);
  const lb = ls(b);
  const has = new Set(lb.map((l) => `${l.from}|${l.to}|${l.rel}`));
  const hasKey = new Set(
    lb.filter((l) => l.key).map((l) => `${l.from}|${l.to}|${l.rel}`),
  );
  const keys = la.filter((l) => l.key);
  const rest = la.filter((l) => !l.key);
  const order = [
    ...new Set([
      ...keys.flatMap((l) => [l.from, l.to]),
      ...a.parts.map((p) => p.id),
    ]),
  ];
  const map = new Map<string, string>();
  const used = new Set<string>();
  // a link with both ends matched: kept or not
  const holds = (l: (typeof la)[number], set: Set<string>) =>
    !map.has(l.from) ||
    !map.has(l.to) ||
    set.has(`${map.get(l.from)}|${map.get(l.to)}|${l.rel}`);
  let best: number | null = null;
  const kept = () =>
    rest.filter(
      (l) =>
        map.has(l.from) &&
        map.has(l.to) &&
        has.has(`${map.get(l.from)}|${map.get(l.to)}|${l.rel}`),
    ).length;
  const go = (i: number) => {
    if (best === rest.length) return;
    if (i === order.length) {
      best = Math.max(best ?? 0, kept());
      return;
    }
    const x = order[i];
    // a part of a key link must be matched; another may have no twin
    const tries: (string | null)[] = [
      ...b.parts.map((p) => p.id).filter((y) => !used.has(y)),
      ...(keys.some((l) => l.from === x || l.to === x) ? [] : [null]),
    ];
    for (const y of tries) {
      if (y) {
        map.set(x, y);
        used.add(y);
      }
      if (keys.every((l) => holds(l, hasKey))) go(i + 1);
      if (y) {
        map.delete(x);
        used.delete(y);
      }
    }
  };
  if (keys.length) go(0);
  return best;
}

// A new case must look different: not the same parts with new numbers, not
// the same case, not the same graph with its names and numbers changed (in
// its case text, or its own parts and links: "Grades by student ID" was the
// hash map's seven links relabelled), and the same kinds of verb on its key
// links.
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
  const was = caseEdges(orig.case);
  const now = caseEdges(next.case);
  if (was.length >= 3 && sameGraph(was, now))
    p.push(
      "its case is the original's graph with new names and numbers: use a different number of nodes and different connections",
    );
  const rest = orig.links.filter((l) => !l.key && !l.argued).length;
  const kept = renamedLinks(orig, next);
  if (sameModel(orig, next))
    p.push(
      "its parts and links are the original's, one for one, under new labels: change the shape of the problem (a different number of parts, or different links between them)",
    );
  // the original renamed, with a part dropped and a leaf or two added: the
  // key links on the same parts and most of the other links kept too ("A
  // photo arriving out of order" was TCP's four core links renamed)
  else if (kept !== null && rest > 0 && kept * 2 >= rest)
    p.push(
      `its links are the original's under new names (the key links and ${kept} of the original's ${rest} other links, on the same parts): keep the key links' kinds of verb, but build a different case around them, with other parts and other links between them`,
    );
  if (keyFamilies(orig) !== keyFamilies(next))
    p.push(
      `its key links must use the same kinds of verb as the original's (${keyFamilies(orig) || "none"})`,
    );
  return p;
}

const keyWords = (m: RefModel) =>
  m.links.filter((l) => l.key && !l.argued).map((l) => linkWords(m, l));
// a link by its parts' names and its verb, so two steps on one cast compare
const named = (m: RefModel, l: Triple) => {
  const c = canon(l);
  return `${normAnswer(labelOf(m, c.from))}|${c.rel}|${normAnswer(labelOf(m, c.to))}`;
};

// A step must teach something new, or add to the step before: refused when
// every key link of its model is a key link of another step's (by the
// parts' names), or its what-if breaks the same part to the same effect.
// Step 2 came back as step 1 with its antigen renamed, and the review then
// listed each key link twice.
export function repeats(m: RefModel, others: readonly RefModel[]): string[] {
  const p: string[] = [];
  const keys = m.links.filter((l) => l.key && !l.argued);
  const wi = (x: RefModel) =>
    x.whatif
      ? `${normAnswer(labelOf(x, x.whatif.fails))}>${x.whatif.affected
          .map((id) => normAnswer(labelOf(x, id)))
          .sort()
          .join(",")}`
      : "";
  for (const o of others) {
    if (o.id === m.id || o.step === m.step || o.of) continue;
    const theirs = new Set(
      o.links.filter((l) => l.key && !l.argued).map((l) => named(o, l)),
    );
    if (keys.length && keys.every((l) => theirs.has(named(m, l))))
      p.push(
        `its key links (${keyWords(m).join("; ")}) are the key links of step "${o.step}" already: a step teaches a new idea or adds to the one before, so its key links are the links this step is about`,
      );
    if (wi(m) && wi(m) === wi(o))
      p.push(
        `its what-if breaks the same part to the same effect as step "${o.step}"'s: ask what breaks in this step's own idea`,
      );
  }
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
// when there are MIXED_FROM or more (mixing them is the point).
export function mixedOrder(ids: readonly string[], seed: number): string[] {
  const out = shuffled(ids, seed);
  if (ids.length >= MIXED_FROM && out.every((x, i) => x === ids[i]))
    out.push(out.shift()!);
  return out;
}

// ---------------------------------------------------------------- fading

// a part's card is 172 wide on the canvas: a column of 260 leaves room for
// the verb between two of them
const COL = 260;
const ROW = 110;
// L0's columns before its layers fold: the build's canvas sits between the
// tray and the side card (about 730 wide at 1440), and four columns of 260
// opened a free step at 0.68, its role lines at 7px; the worked case has the
// width and keeps four (frame.ts)
const BUILD_COLS = 3;

// The links with each one that closes a loop left out ("Antibody prevents
// H1N1 virus" after the virus started the chain). Layered with a loop in,
// every part on it climbs to the last layer and they all fall in one column.
function acyclic(m: RefModel): RefLink[] {
  const state = new Map<string, "open" | "done">();
  const keep: RefLink[] = [];
  const visit = (id: string) => {
    state.set(id, "open");
    for (const l of m.links.filter((x) => x.from === id)) {
      if (state.get(l.to) === "open") continue;
      keep.push(l);
      if (!state.has(l.to)) visit(l.to);
    }
    state.set(id, "done");
  };
  for (const p of m.parts) if (!state.has(p.id)) visit(p.id);
  return keep;
}

// What each help level gives before you start: L0 every part where the
// worked case had it and every link but the key ones; L1 every part on a
// plain grid in a shuffled order, no links; L2 and L3 nothing placed. On a
// frame the slot is the answer too (placingIsAnswer: an axis's order, a
// sort's columns, which lane or box), so at L1 its parts wait beside the
// frame for you to put in (the tray says how many are still to go in).
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
    const forward = acyclic(m);
    for (let i = 0; i < m.parts.length; i++)
      for (const l of forward)
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
    const slotted = inSlots(
      m,
      [...m.parts].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!),
    );
    for (const p of m.parts) {
      const d = depth.get(p.id)!;
      const r = rows.get(d)!;
      rows.set(d, r + 1);
      // past BUILD_COLS columns the layers fold into rows that run back
      // the other way, as the screen draws the worked case
      const fold = Math.floor(d / BUILD_COLS);
      const col = fold % 2 ? BUILD_COLS - 1 - (d % BUILD_COLS) : d % BUILD_COLS;
      b.placed.push({
        part: p.id,
        ...(slotted.get(p.id) ?? {
          x: col * COL,
          y: r * ROW + fold * (tall * ROW + 40),
        }),
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
    const slotted = !placingIsAnswer(m.frame);
    const order = shuffled(m.parts, seedOf(m.id));
    const at = slotted ? inSlots(m, order) : new Map<string, Spot>();
    order.forEach((p, i) =>
      b.placed.push({
        part: p.id,
        ...(at.get(p.id) ?? {
          x: (i % 3) * COL,
          y: Math.floor(i / 3) * ROW,
        }),
        ...(p.slot && slotted ? { slot: p.slot[0] } : {}),
      }),
    );
  }
  return b;
}

type Spot = { x: number; y: number };

// Parts given their slot, one after another in it, in the order given:
// along a lane, down a column. Laid out by depth, a step of four lanes ran
// four columns wide however few parts each lane held, and the canvas opened
// at half size with its words at 7px. Boxes place their parts themselves,
// and a free map has no slots, so neither is here.
function inSlots(m: RefModel, order: readonly Part[]): Map<string, Spot> {
  const out = new Map<string, Spot>();
  if (
    m.frame.kind !== "lanes" &&
    m.frame.kind !== "axis" &&
    m.frame.kind !== "sort"
  )
    return out;
  const k = new Map<string, number>();
  for (const p of order) {
    const slot = p.slot?.[0];
    if (!slot) continue;
    const i = k.get(slot) ?? 0;
    k.set(slot, i + 1);
    out.set(
      p.id,
      m.frame.kind === "lanes"
        ? { x: 16 + i * COL, y: 0 }
        : { x: 0, y: 8 + i * ROW },
    );
  }
  return out;
}

// ---------------------------------------------------------------- your moves on a build

const placedHas = (b: Build, part: string) =>
  b.placed.some((p) => p.part === part);

// the next free spot: below the last part placed
const nextSpot = (b: Build) => ({
  x: (b.placed.length % 3) * COL,
  y: Math.floor(b.placed.length / 3) * ROW,
});

// A spot the browser sends, kept on the canvas: a number, rounded, within
// a range far wider than any frame (1e308 opened the step at 3e38 px, and
// the build could not be used until the part was taken back).
export const COORD = 5000;
export function coord(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(-COORD, Math.min(COORD, Math.round(v)))
    : undefined;
}

// the next place in the order parts come into their slots
const nextN = (b: Build) => Math.max(0, ...b.placed.map((p) => p.n ?? 0)) + 1;

export function placePart(
  m: RefModel,
  b: Build,
  part: string,
  at?: { x?: unknown; y?: unknown; slot?: unknown },
): string | null {
  if (!isPart(m, part)) return "No such part.";
  if (placedHas(b, part)) return "That part is already placed.";
  const spot = nextSpot(b);
  const slot = cleanSlot(slotFrom(m.frame, at?.slot), m.frame)?.[0];
  b.placed.push({
    part,
    x: coord(at?.x) ?? spot.x,
    y: coord(at?.y) ?? spot.y,
    ...(slot ? { slot, n: nextN(b) } : {}),
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
  p.x = coord(at.x) ?? p.x;
  p.y = coord(at.y) ?? p.y;
  if (at.slot !== undefined) {
    const slot = cleanSlot(slotFrom(m.frame, at.slot), m.frame)?.[0];
    // a part moved into another slot comes last in it; moved within its
    // own, it keeps its place
    if (slot && slot !== p.slot) {
      p.slot = slot;
      p.n = nextN(b);
    } else if (!slot) {
      delete p.slot;
      delete p.n;
    }
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
  if (!isVerb(rel) || !verbsOf(m).includes(rel))
    return "That verb is not one this frame uses.";
  if (b.links.some((l) => sameLink(l, { from, to, rel })))
    return "Those two are already linked that way.";
  const link: BuildLink = { id: `y${b.next++}`, from, to, rel };
  b.links.push(link);
  return link;
}

// Change one of your links: its verb, or its direction. A change that makes
// it the same as a link already drawn merges the two (reversed onto a hint's
// link you had accepted, the same link was drawn twice and one copy was
// marked a near verb). The last check's mark on it goes: it was about the
// link as it was (a reversed link kept its "points the wrong way" row, now
// reworded about the right one).
export function relinkParts(
  m: RefModel,
  b: Build,
  id: string,
  change: { rel?: unknown; reverse?: unknown },
): string | null {
  const l = b.links.find((x) => x.id === id);
  if (!l || l.given) return "That link is not yours to change.";
  const next = { from: l.from, to: l.to, rel: l.rel };
  if (change.rel !== undefined) {
    if (!isVerb(change.rel) || !verbsOf(m).includes(change.rel))
      return "That verb is not one this frame uses.";
    next.rel = change.rel;
  }
  if (change.reverse === true) [next.from, next.to] = [next.to, next.from];
  forget(b, id);
  if (b.links.some((x) => x !== l && sameLink(x, next)))
    b.links = b.links.filter((x) => x !== l);
  else Object.assign(l, next);
  return null;
}

export function unlinkParts(b: Build, id: string): string | null {
  const l = b.links.find((x) => x.id === id);
  if (!l || l.given) return "That link is not yours to remove.";
  b.links = b.links.filter((x) => x !== l);
  forget(b, id);
  return null;
}

// the last check's mark on a link you changed or took away
function forget(b: Build, id: string) {
  if (b.last) b.last.marks = b.last.marks.filter((x) => x.link !== id);
}

// your links and where your parts sit, to tell whether you changed them
// since the last check
export const buildKey = (b: Build): string =>
  [
    ...b.links.map((l) => `${l.from}|${l.rel}|${l.to}`),
    ...b.placed.map((p) => `${p.part}@${p.slot ?? ""}`),
  ]
    .sort()
    .join(";");

// Only the key links are graded at L0, in a quick rebuild and in a review:
// a rebuild from memory is what the schedule's items are, and they are the
// key links (a review at L1 still wanted 3 of 4 other links, while its
// headline counted key links only, and a step left open by it stayed open).
export const keyOnlyFor = (
  b: Build,
  st?: { recall?: boolean; reviewing?: boolean },
): boolean => b.help === 0 || !!st?.recall || !!st?.reviewing;

// What hints aim at: a key link you do not have yet, in the model's order;
// once every key link is there, one of the other links a pass still needs
// (with all key links right and help off, a review could be passed only by
// guessing verbs for links it never asked about); then where a part sits,
// when that is what stops the pass (openPlace: an order wrong on an axis
// had Hint and Show one link both off, and Show the model was the only help
// left); then any other link you do not have.
export function openAid(
  m: RefModel,
  b: Build,
  keyOnly = false,
): { link: RefLink } | { part: string } | undefined {
  const have = (r: RefLink) => b.links.some((l) => sameLink(l, r));
  const missing = m.links.filter((r) => !r.argued && !have(r));
  const key = missing.find((r) => r.key);
  if (key) return { link: key };
  const rest = m.links.filter((r) => !r.key && !r.argued);
  const need = Math.ceil(rest.length * PASS_SHARE - 1e-9);
  const other = keyOnly ? undefined : missing.find((r) => !r.key);
  if (other && rest.length - missing.filter((r) => !r.key).length < need)
    return { link: other };
  const part = openPlace(m, b);
  if (part) return { part };
  return other ? { link: other } : undefined;
}

export function openLink(
  m: RefModel,
  b: Build,
  keyOnly = false,
): RefLink | undefined {
  const aid = openAid(m, b, keyOnly);
  return aid && "link" in aid ? aid.link : undefined;
}

// The part whose place stops a pass: on an axis, the first in the model's
// order of the parts out of order or off the ticks, one that is not on its
// own tick first (a part on its very tick is in a pair out of order only
// through the part wrongly beside it, and "Look at where /healthz probe
// sits" sent you to move the one part that was right); on another frame,
// the first left outside it that the model has a slot for.
export function openPlace(m: RefModel, b: Build): string | undefined {
  const valid = slotsOf(m.frame);
  if (!valid.length) return undefined;
  const ref = new Map(m.parts.map((p, i) => [p.id, { p, i }]));
  const placed = b.placed.filter((x) => ref.has(x.part));
  const on = (x: { slot?: string }) => !!x.slot && valid.includes(x.slot);
  const rank = (id: string) => {
    const r = ref.get(id)!;
    return rankOf(m, r.p, r.i);
  };
  const byRank = [...placed].sort((a, c) => rank(a.part) - rank(c.part));
  if (m.frame.kind === "axis") {
    const tick = (x: { slot?: string }) => valid.indexOf(x.slot!);
    const wrong = byRank.filter(
      (a) =>
        !on(a) ||
        placed.some(
          (c) =>
            on(c) &&
            c !== a &&
            ((rank(a.part) < rank(c.part) && tick(a) >= tick(c)) ||
              (rank(c.part) < rank(a.part) && tick(c) >= tick(a))),
        ),
    );
    return (wrong.find((a) => a.slot !== homeOf(m, a.part)) ?? wrong[0])?.part;
  }
  return byRank.find((x) => !on(x) && !!ref.get(x.part)!.p.slot?.length)?.part;
}

// the slot a part belongs in, as Show one place puts it there: its own, or
// on an axis with none, the tick of its place in the order
function homeOf(m: RefModel, part: string): string | undefined {
  const i = m.parts.findIndex((p) => p.id === part);
  const p = m.parts[i];
  if (!p) return undefined;
  if (p.slot?.length) return p.slot[0];
  return m.frame.kind === "axis" ? m.frame.ticks[i] : undefined;
}

// The next hint rung on what openAid aims at. On a link: where (one end),
// then Claude's question, then the link as a ghost with its verb hidden. On
// where a part sits: one rung, the part named. Only after a first check. A
// rung whose text gave the link away is skipped. Where names the end you
// have not linked yet: you had linked "Commit history" to the wrong part,
// and "Look at Commit history" pointed back at it.
export function nextHint(
  m: RefModel,
  b: Build,
  keyOnly = false,
): { link: string; rung: 1 | 2 | 3; end?: "to" } | string {
  if (!b.checks) return "Check once first; hints come after a first try.";
  const aid = openAid(m, b, keyOnly);
  if (!aid) return "Every link is already there.";
  if ("part" in aid) {
    const id = `place:${aid.part}`;
    if (b.hints.some((h) => h.link === id))
      return "No hints left on this part: Show one place.";
    return { link: id, rung: 1 };
  }
  const target = aid.link;
  const used = b.hints.filter((h) => h.link === target.id).map((h) => h.rung);
  const rungs = ([1, 2, 3] as const).filter(
    (r) => !used.includes(r) && (r !== 2 || !!target.hint),
  );
  if (!rungs.length) return "No hints left on this link: Show one link.";
  const tried = b.links.some(
    (l) =>
      !l.given &&
      (l.from === target.from || l.to === target.from) &&
      l.from !== target.to &&
      l.to !== target.to,
  );
  return {
    link: target.id,
    rung: rungs[0],
    ...(rungs[0] === 1 && tried ? { end: "to" as const } : {}),
  };
}

// Show one link: what openAid aims at, shown and marked so. A link you do
// not have is drawn for you; it takes the place of your tries at it on the
// same two parts (another verb, or its family's verb the wrong way round):
// drawn beside them, the two read as one. A link of yours on that pair that
// says something else (not in Claude's model, or a mix-up) stays: it is a
// claim of its own, and it went with no word, its Argue for it too. A part
// whose place stops the pass is put in its slot.
export function showOneLink(
  m: RefModel,
  b: Build,
  keyOnly = false,
): { link: RefLink } | { part: string } | string {
  const aid = openAid(m, b, keyOnly);
  if (!aid) return "Every link is already there.";
  if ("part" in aid) {
    const slot = homeOf(m, aid.part);
    const p = b.placed.find((x) => x.part === aid.part);
    if (!slot || !p) return "Every part is in its place.";
    if (p.slot !== slot) p.n = nextN(b);
    p.slot = slot;
    b.shown.push(`place:${aid.part}`);
    return aid;
  }
  const target = aid.link;
  const t = canon(target);
  // a try at the target: the same way round with any verb, or the other
  // way round with a verb of its family (as grade marks them ~ and ↔)
  const tries = (l: Triple) => {
    const c = canon(l);
    return (
      (c.from === t.from && c.to === t.to) ||
      (c.from === t.to &&
        c.to === t.from &&
        familyOf(c.rel) === familyOf(t.rel))
    );
  };
  b.links = b.links.filter(
    (l) =>
      l.given ||
      !tries(l) ||
      m.links.some((r) => sameLink(r, l)) ||
      !!misconOf(m, l),
  );
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
  return aid;
}

// ---------------------------------------------------------------- credit

// how each key link came out of a rebuild: right at the first check by you;
// shown; wrong at the first check while sure; right with help on it
// (hinted); right after a check, with no help (fixed: it was logged
// "hinted" with no hint taken); never right
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
  // a hint on it, or a reply of Claude's that named it
  const hinted = new Set([...b.hints.map((h) => h.link), ...(b.told ?? [])]);
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
    else if (rightNow.has(r.id))
      out[r.id] = {
        how: hinted.has(r.id) || touchesHinted || !b.first ? "hinted" : "fixed",
      };
    else
      out[r.id] = {
        how: "wrong",
        ...(b.firstSure ? { sure: b.firstSure } : {}),
      };
  }
  return out;
}

// A whole build's credit: shown if anything was shown, with hints if a hint
// or a "did you mean" was taken or a reply of Claude's named a key link,
// otherwise yours. A link fixed after a check
// with no hint is still yours (the check gives counts and places, never the
// fix); the review schedule (outcomes) is stricter and wants it right at
// the first check.
export function creditOf(b: Build, viaModel = false): Credit {
  if (viaModel || b.shown.length) return "shown";
  if (b.hints.length || b.hinted?.length || b.told?.length) return "hints";
  return "you";
}

// ---------------------------------------------------------------- schedule

// The local calendar day of a time: a promotion counts once per day.
export const localDay = (t: number): number =>
  Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / DAY);

const item = (
  m: RefModel,
  ref: string,
  kind: Item["kind"],
  now: number,
): Item => ({
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

// One item per key link, made when a step is Built: box 1, due in a day.
export const newItems = (m: RefModel, now: number): Item[] =>
  m.links
    .filter((l) => l.key && !l.argued)
    .map((l) => item(m, l.id, "link", now));

// The what-if is optional: its item is made the first time you try it, so
// one you never did is never due.
export const whatifItem = (m: RefModel, now: number): Item | null =>
  m.whatif ? item(m, "whatif", "whatif", now) : null;

// The items a review rebuild answers, and so the ones that make a step due
// and set its help: its key links. A what-if is asked again on the built
// step when it falls due (review in build.ts), never by a rebuild: counted
// here it kept a finished review due, with nothing to grade, and held the
// step's help at L1 for ever.
export const rebuilt = (i: Item): boolean => i.kind === "link" && !i.retired;

// An answer on an item. Unaided right moves it up a box, once a local day
// (and never on the day it was built); hinted, or fixed after a check,
// keeps the box, due tomorrow; shown or wrong sends it back to box 1. Wrong while sure flags its
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
  } else if (how === "hinted" || how === "fixed") {
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
  const live = items.filter(rebuilt);
  const low = live.length ? Math.min(...live.map((i) => i.box)) : 3;
  const h = low <= 1 ? 1 : low === 2 ? 2 : 3;
  return Math.max(0, recallWrong ? h - 1 : h) as Help;
}

// A step's help when a review opens: its items' level (helpFor), never more
// help than its last rebuild had when every key link of it came out by you
// (a step built cold at L2 came back at L1, with the parts placed, under a
// card promising less help). `last`: that rebuild's help, if any.
export function reviewHelp(
  items: Item[],
  last: Help | null,
  recallWrong = false,
): Help {
  const h = helpFor(items, recallWrong);
  const live = items.filter(rebuilt);
  const byYou =
    !recallWrong &&
    live.length > 0 &&
    live.every((i) => i.log.at(-1)?.how === "unaided");
  return (byYou && last !== null ? Math.max(h, last) : h) as Help;
}

// How many steps are due now (a step with a live item due), and when the
// next item falls due. Steps, as the review card counts them: the rail said
// "Due: 6 now" (key links) beside "2 steps are due". Items of a step that is
// no longer on the path wait, uncounted.
export function dueOf(
  s: LearnState,
  live: ReadonlySet<string>,
  now: number,
): { now: number; next: number | null } {
  const due = new Set<string>();
  let next: number | null = null;
  for (const i of Object.values(s.items)) {
    const m = own(s.models, i.model);
    if (!rebuilt(i) || !m || !live.has(m.step)) continue;
    if (i.due <= now) due.add(m.step);
    else if (next === null || i.due < next) next = i.due;
  }
  return { now: due.size, next };
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

// A build's answers onto its model's items: how each key link came out.
export function logOutcomes(
  s: LearnState,
  m: RefModel,
  b: Build,
  now: number,
): void {
  for (const [link, o] of Object.entries(outcomes(m, b))) {
    const i = own(s.items, `${m.id}:${link}`);
    if (i) record(i, o.how, now, o.sure);
  }
}

// Today, unaided, while a review is open: what is logged since it opened,
// and the rebuilds checked but not passed yet, as they stand (they are
// logged when they pass, or when you are done), so the count moves with
// your first check rather than at the end.
export function todayOf(s: LearnState): { unaided: number; of: number } {
  const r = s.review;
  if (!r) return { unaided: 0, of: 0 };
  const t = unaidedSince(s, r.at);
  for (const step of r.order) {
    const m = own(s.models, own(s.stepModel, step) ?? "");
    const b = m && own(s.builds, m.id);
    if (!m || !b?.checks || !s.steps[step]?.reviewing) continue;
    for (const o of Object.values(outcomes(m, b))) {
      t.of++;
      if (o.how === "unaided") t.unaided++;
    }
  }
  return t;
}

// A review opened on an earlier day is over: the next one is a visit of
// its own, with its own gap, levels and count.
export const staleReview = (s: LearnState, now: number): boolean =>
  !!s.review && localDay(s.review.at) !== localDay(now);

// The open review's score, kept as its visit (once per review, updated as
// it goes): it is kept as soon as every due step is rebuilt, not only by
// I'm done today, which sat below the fold (the maps list said nothing of a
// finished review). Only when something was rebuilt: an empty visit would
// put "0 of 0" over the last real score.
export function keepVisit(s: LearnState): { unaided: number; of: number } {
  const r = s.review;
  if (!r) return { unaided: 0, of: 0 };
  const today = unaidedSince(s, r.at);
  if (today.of > 0) {
    const v = {
      at: r.at,
      unaided: today.unaided,
      of: Math.max(r.items, today.of),
    };
    const i = s.visits.findIndex((x) => x.at === r.at);
    if (i >= 0) s.visits[i] = v;
    else s.visits.push(v);
  }
  return today;
}

// Claude's line under a Why verdict, without the verdict said again (the
// card reads "✓ Right." and the line began "Right: the Constitution…")
export const bareSay = (say: string): string =>
  say
    .replace(
      /^\s*(right|correct|exactly|yes|partly|partially|not yet|not quite|wrong|no)\s*[.!:,;—–-]+\s*/i,
      "",
    )
    .replace(/^./, (c) => c.toUpperCase());

// End the open review (I'm done today, or a new day): what you checked is
// logged, at the time you checked it, what you did not stays due, and the
// visit's score is kept. Logged at the time it was ended, a rebuild checked
// on day 1 and closed on day 16 counted as day 16's answer: it moved its
// items up and out of due, and the review the map had offered would not
// start.
export function endReview(
  s: LearnState,
  now: number,
): { unaided: number; of: number } | null {
  const r = s.review;
  if (!r) return null;
  for (const step of r.order) {
    const st = own(s.steps, step);
    const m = own(s.models, own(s.stepModel, step) ?? "");
    if (!st?.reviewing || !m) continue;
    const b = own(s.builds, m.id);
    if (b?.checks) logOutcomes(s, m, b, Math.min(now, b.last?.at || now));
    st.reviewing = false;
    st.stage = "built";
  }
  const today = keepVisit(s);
  s.review = null;
  return today;
}

// An argued link Claude accepted is right from now on: the last check says
// so at once, so its row leaves "Not in Claude's model" and Argue for it
// goes (a second argue was a second paid move on a link already accepted).
export function acceptArgued(b: Build, link: Triple): void {
  const c = b.last;
  if (!c) return;
  for (const mk of c.marks) {
    const l = b.links.find((x) => x.id === mk.link);
    if (!ARGUABLE.includes(mk.mark) || !l || !sameLink(l, link)) continue;
    if (mk.mark === "extra") c.extra--;
    else if (mk.mark === "family") c.family--;
    else c.miscon--;
    mk.mark = "right";
    delete mk.refute;
    c.argued = (c.argued ?? 0) + 1;
  }
}

// "Which idea is this?": one card per due step, its what-if question (or its
// new case's title), with the built steps' titles as choices. The server
// knows the answer, so it costs no call.
export function ideaCards(
  s: LearnState,
  due: readonly string[],
  built: readonly string[],
  seed: number,
  parents: Record<string, string | null> = {},
): Card[] {
  if (built.length < 3) return [];
  // A step and one gone deeper inside it (or out of it) are one idea: on the
  // card for "Inside: Keep if shorter", "How does one round run?" was as fair
  // an answer, and marked ✗. Neither is offered on the other's card.
  const above = (a: string, b: string) => {
    for (let x = parents[a]; x; x = parents[x]) if (x === b) return true;
    return false;
  };
  const kin = (a: string, b: string) => above(a, b) || above(b, a);
  const cards: Card[] = [];
  for (const step of due) {
    const m = own(s.models, own(s.stepModel, step) ?? "");
    const c = s.steps[step]?.caseModel
      ? own(s.models, s.steps[step].caseModel!)
      : undefined;
    const ask = m?.whatif?.ask || (c?.status === "ready" ? c.title : "");
    if (!ask) continue;
    const others = shuffled(
      built.filter((x) => x !== step && !kin(x, step)),
      seed + cards.length,
    ).slice(0, 3);
    if (!others.length) continue;
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
// one line each, so the prompt stays small. `full` is for the moves that
// work on the reference (writing a model, judging a why, an argue, a new
// case). Any other move (Explain, a thread, the message box) on a step you
// have not built gets its parts only: with the links and slots in front of
// it, an explanation named which box every part goes in.
export function outlineOf(
  s: LearnState,
  nodes: Record<string, MapNode>,
  {
    full = true,
    at: about,
    others = false,
  }: {
    full?: boolean;
    at?: string | null;
    // a move that writes a model: the other steps' key links and what-ifs,
    // so a new step teaches something new (step 2 came back as step 1 with
    // its antigen renamed: the same key links, the same what-if)
    others?: boolean;
  } = {},
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
    if (others && m?.status === "ready" && p.id !== about)
      lines.push(
        `${"  ".repeat(p.depth)}    its key links: ${keyWords(m).join("; ")}${m.whatif ? ` · its what-if breaks "${labelOf(m, m.whatif.fails)}"` : ""}`,
      );
  }
  const at = [about, s.at].find((x) => !!x && own(s.steps, x)) ?? undefined;
  const st = at ? s.steps[at] : undefined;
  const main = at ? own(s.models, own(s.stepModel, at) ?? "") : undefined;
  const m = st?.onCase && st.caseModel ? own(s.models, st.caseModel) : main;
  if (at && st && m && !full && st.stage !== "built") {
    lines.push(
      "",
      `CURRENT STEP [${at}] "${title(at)}": the learner is building it back from memory, so its model is not shown to you on this move. Say what a part IS, in general; never which part links to which, which box, lane or column a part sits in, or the order the parts come in, and never two parts in one line. Name parts by their label in quotes. An explanation of the step is one line per part: "Label": what it is.`,
      `  case: "${m.title}": ${m.case}`,
      "  parts:",
      ...m.parts.map((p) => `    "${p.label}": ${p.role}`),
    );
    return lines.join("\n");
  }
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
          `    [${l.id}] ${linkWords(m, l)}${l.key ? " · KEY" : ""}${l.argued ? " · argued by the learner, accepted" : ""}${l.also?.length ? ` · also said with: ${l.also.join(", ")} (argued by the learner, accepted)` : ""}${l.rubric ? ` · rubric: ${l.rubric}` : ""}`,
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

// The step on the path a node is, or sits under (a fact Claude added to a
// step, a thread's node), if any.
export function stepOf(
  nodes: Record<string, MapNode>,
  nodeId: string | null | undefined,
): string | null {
  const path = new Set(pathSteps(nodes).map((p) => p.id));
  for (let n = nodeId ? own(nodes, nodeId) : undefined; n;) {
    if (path.has(n.id)) return n.id;
    n = n.parent ? own(nodes, n.parent) : undefined;
  }
  return null;
}

// ---------------------------------------------------------------- the view

// the id the worked case's hidden part goes out under
export const HIDDEN = "hidden-part";

// Whether a text names a label: its whole phrase, all its own words ("The
// House" in "House 415-14 June 16"), or half of them with one no other part
// has ("signed June 17" names "President signs"; "17,000 bills" does not
// name "Bill dies", as other parts are bills too).
function mentions(text: string, label: string, m: RefModel): boolean {
  if (!text.trim() || !label.trim()) return false;
  if (phrase(text).includes(phrase(label))) return true;
  const said = new Set(wordsOf(text).map(root));
  const words = (s: string) => [
    ...new Set(
      wordsOf(s)
        .filter((x) => x.length >= 3 && !STOP.has(x))
        .map(root),
    ),
  ];
  const w = words(label);
  const got = w.filter((x) => said.has(x));
  const others = new Set(
    m.parts
      .filter((p) => normAnswer(p.label) !== normAnswer(label))
      .flatMap((p) => words(p.label)),
  );
  return (
    w.length > 0 &&
    (got.length === w.length ||
      (got.length * 2 >= w.length && got.some((x) => !others.has(x))))
  );
}

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
  const saved = own(s.steps, p.id) ?? freshStep(s.level);
  // a review left open from an earlier day is over (the next action ends it):
  // its steps read as built until a new review opens
  const st =
    saved.reviewing && staleReview(s, now)
      ? { ...saved, reviewing: false, stage: "built" as const }
      : saved;
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
    // what went wrong is Claude's (said to it in its retry), never the
    // learner's to read: it named ids, and the key links of the model
    model: m ? (m.status === "ready" ? "ready" : m.status) : "none",
    stage: st.stage,
    help: st.help,
    mode: m?.mode ?? "build",
    layer: m?.layer ?? "behaviour",
    caseTitle: m?.title ?? "",
    case: m?.case ?? "",
    frame: m?.frame ?? { kind: "free" },
    verbs: m ? verbsOf(m) : verbsFor("free"),
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
    told: 0,
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
    recalled: st.recall ? null : (st.recalled ?? null),
    reviewing: !!st.reviewing,
    lowered: !!st.reviewing && !!st.lowered,
    ...(st.viaModel ? { viaModel: true } : {}),
    itemsDue: items.filter((i) => rebuilt(i) && i.due <= now).length,
  };
  if (!m || !ready) return base;
  // what the frame's own labels must not say (maskFrame)
  let hide: { names: string[]; answer: string } | null = null;

  // the worked case: while you see it, or after Show the model (with the
  // links you argued for and Claude accepted: they joined it); before you
  // predict, the link the predict question is about stays hidden. Not before
  // you say how much you know: it sat under the level chooser, and "I know
  // some" then built it "by you" with the answer just read (Peek at the
  // worked case is there for that, and counts as shown).
  const seeing = st.stage === "see" && s.level !== null;
  if (seeing || st.shownModel) {
    const hideLink =
      st.stage === "see" && !st.predicted && !st.shownModel
        ? livePredict(m)?.hides
        : undefined;
    // the end that is the answer is the one drawn as "?": a predict can ask
    // about either end ("which cell deals with the virus?" asks the from end)
    const hidden = hideLink ? hiddenEnd(m) : null;
    // The hidden part goes out under a name of no meaning: its own id
    // ("house") was in the canvas's labels, read out by a screen reader.
    // The parts linked to it keep their labels but not their roles until
    // you answer ("Second chamber votes again" said which voted first), and
    // none of its links is drawn: "? activates B cell" and "? activates
    // Killer T cell" were the Helper T cell the step before had taught,
    // with the question "which cell does the dendritic cell show it to?".
    const near = new Set(
      hidden
        ? m.links.flatMap((l) =>
            l.from === hidden ? [l.to] : l.to === hidden ? [l.from] : [],
          )
        : [],
    );
    base.worked = {
      parts: m.parts.map((x) =>
        x.id === hidden
          ? { id: HIDDEN, label: "?", role: "" }
          : {
              ...partView(x),
              ...(near.has(x.id) ? { role: "" } : {}),
              ...(x.slot ? { slot: x.slot[0] } : {}),
            },
      ),
      links: m.links
        .filter(
          (l) => l.id !== hideLink && l.from !== hidden && l.to !== hidden,
        )
        .map((l) => linkView(l)),
      hidden: hidden ? HIDDEN : null,
    };
    // the case line can say the answer outright ("passed Senate June 15,
    // House June 16"): while the question is open it says so only when it
    // does not name the answer or the hidden part
    if (hidden) {
      const tells = (t: string) =>
        mentions(t, m.predict?.answer ?? "", m) ||
        mentions(t, m.parts.find((x) => x.id === hidden)?.label ?? "", m);
      if (tells(base.case)) base.case = "";
      if (tells(base.caseTitle)) base.caseTitle = "";
      hide = {
        names: [m.parts.find((x) => x.id === hidden)?.label ?? ""],
        answer: m.predict?.answer ?? "",
      };
    }
  }
  const pr = livePredict(m);
  if (seeing && pr && !st.shownModel) {
    const pick = st.predicted?.pick ?? null;
    const choice = pr.choices.find((c) => c.text === pick);
    const right =
      pick === null ? null : normAnswer(pick) === normAnswer(pr.answer);
    base.predict = {
      ask: pr.ask,
      choices: pr.choices.map((c) => c.text),
      picked: pick,
      sure: st.predicted?.sure ?? null,
      right,
      // a wrong pick: its misconception, or Claude's line on why not
      refute:
        right === false
          ? (choice?.miscon &&
              m.miscon.find((x) => x.id === choice.miscon)?.refute) ||
            choice?.why ||
            null
          : null,
      // and the right one: the pick is final, and the whole case is on
      // screen from now on (a case may not show it: a resized array)
      ...(right === false ? { correct: pr.answer } : {}),
    };
  }

  const b =
    own(s.builds, m.id) ??
    (st.stage === "build" ? startBuild(m, st.help) : undefined);
  if (b) {
    // a new case is built at its own help (L2, or L1 after Show the model),
    // not the step's
    if (m !== main) base.help = b.help;
    const label = (id: string) => m.parts.find((x) => x.id === id)!;
    base.placed = b.placed
      .filter((x) => isPart(m, x.part))
      .map((x) => ({
        ...partView(label(x.part)),
        x: x.x,
        y: x.y,
        ...(x.slot ? { slot: x.slot } : {}),
        ...(x.slot && x.n ? { n: x.n } : {}),
      }));
    base.links = b.links.map(linkView);
    // how many key links the model has, said up front ("Draw the 2 missing
    // links"): a count, never which
    base.keys = m.links.filter((l) => l.key && !l.argued).length;
    base.check = b.last;
    base.checks = b.checks;
    base.sure = b.sure ?? null;
    // one shuffle of every part, then the ones not placed: shuffling only
    // what is left reordered the tray on every click, under the pointer
    const unplaced = shuffled(m.parts, seedOf(m.id)).filter(
      (x) => !b.placed.some((y) => y.part === x.id),
    );
    base.trayCount = unplaced.length;
    // at L3 you type the names: the tray says only how many are left
    base.tray = b.help === 3 ? [] : unplaced.map(partView);
    base.typed = b.typed ?? null;
    base.argued = b.argued ?? [];
    base.hints = b.hints.flatMap((h): HintView[] => {
      if (h.link.startsWith("place:")) {
        const p = m.parts.find((x) => `place:${x.id}` === h.link);
        return p
          ? [
              {
                rung: 1 as const,
                text: `Look at where "${p.label}" sits${m.frame.kind === "axis" ? " along the axis" : ""}.`,
              },
            ]
          : [];
      }
      const l = m.links.find((x) => x.id === h.link);
      if (!l) return [];
      if (h.rung === 1)
        return [
          {
            rung: 1 as const,
            text: `Look at "${label(h.end === "to" ? l.to : l.from).label}".`,
          },
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
    const aid =
      st.stage === "build" && b.checks > 0
        ? openAid(m, b, keyOnlyFor(b, st))
        : undefined;
    base.canHint = !!aid;
    if (aid && "part" in aid) base.hintOn = "place";
    // your links or places changed since the last check: its marks are of
    // what was there then
    base.changed =
      !!b.last && b.checked !== undefined && b.checked !== buildKey(b);
    base.told = (b.told ?? []).length;
    // at L3 you type the names: a lane named for a part spells it, and so
    // does a case line ("Sequence number and ACK number on one request"),
    // now on screen while you build
    if (st.stage === "build" && b.help === 3) {
      hide = { names: m.parts.map((x) => x.label), answer: "" };
      const names = (t: string) => m.parts.some((x) => mentions(t, x.label, m));
      if (names(base.case)) base.case = "";
      if (names(base.caseTitle)) base.caseTitle = "";
    }
    // a quick rebuild waiting: the build it rebuilds stays out of view until
    // it is done (it opened beside the quick rebuild card, every link on it)
    if (st.stage === "built" && st.recallDue) {
      base.links = [];
      base.check = null;
    }
  }

  const why = st.whyLink
    ? main?.links.find((l) => l.id === st.whyLink)
    : undefined;
  if (
    main &&
    why?.ask &&
    (st.stage === "why" || (st.stage === "built" && !st.recallDue))
  )
    base.why = {
      ask: why.ask,
      link: {
        from: labelOf(main, why.from),
        to: labelOf(main, why.to),
        rel: why.rel,
      },
      state: st.why?.state ?? null,
      // said without its verdict again, a line saved before included
      say: bareSay(st.why?.say ?? ""),
      tries: st.why?.tries ?? 0,
      pre: st.pre ?? "",
    };
  if (main?.whatif && st.stage === "built") {
    const wi = own(s.items, `${main.id}:whatif`);
    base.whatif = {
      ask: main.whatif.ask,
      fails: labelOf(main, main.whatif.fails),
      due: !!wi && !wi.retired && wi.due <= now,
      result: st.whatif
        ? {
            found: st.whatif.found,
            // a try saved before the missed parts were named holds a count
            missed: Array.isArray(st.whatif.missed) ? st.whatif.missed : [],
            extra: st.whatif.extra,
            why: main.whatif.why,
          }
        : null,
    };
  }
  if (hide) maskFrame(base, m, hide);
  return base;
}

// whether a text holds a name whole: its phrase, or every one of its own words
function namesAll(text: string, name: string): boolean {
  const w = wordsOf(name)
    .filter((x) => x.length >= 3 && !STOP.has(x))
    .map(root);
  const said = new Set(wordsOf(text).map(root));
  return (
    (!!name.trim() && phrase(text).includes(phrase(name))) ||
    (w.length > 0 && w.every((x) => said.has(x)))
  );
}

const SLOT_WORD: Record<Frame["kind"], string> = {
  free: "Slot",
  lanes: "Lane",
  axis: "Tick",
  boxes: "Box",
  sort: "Column",
};

// The frame as you see it: a lane, tick, column or box whose label says
// what you are to work out goes out by its number ("Lane 3"), and so does
// its slot in every part. While the predict is open, a label that names the
// hidden part or the answer (an empty lane "Left heart side" answered "where
// does it go next?"; a box "Inside order 1042" answered "where are its line
// items stored?"); at L3, one that holds a part's name ("Right heart side").
// The server takes the number back (slotFrom).
function maskFrame(
  base: StepView,
  m: RefModel,
  hide: { names: string[]; answer: string },
): void {
  const f = m.frame;
  const labels = f.kind === "boxes" ? f.boxes.map((x) => x.label) : slotsOf(f);
  const ids = slotsOf(f);
  const tells = (label: string) =>
    hide.names.some((n) => namesAll(label, n)) ||
    (!!hide.answer && mentions(label, hide.answer, m));
  const rename = new Map<string, string>();
  labels.forEach((l, i) => {
    if (tells(l)) rename.set(ids[i], `${SLOT_WORD[f.kind]} ${i + 1}`);
  });
  if (!rename.size) return;
  const to = (x: string) => rename.get(x) ?? x;
  base.frame =
    f.kind === "boxes"
      ? {
          kind: "boxes",
          boxes: f.boxes.map((x) =>
            rename.has(x.id) ? { id: to(x.id), label: to(x.id) } : x,
          ),
        }
      : f.kind === "lanes"
        ? { kind: "lanes", lanes: f.lanes.map(to) }
        : f.kind === "axis"
          ? { kind: "axis", ticks: f.ticks.map(to) }
          : f.kind === "sort"
            ? { kind: "sort", columns: f.columns.map(to) }
            : f;
  base.placed = base.placed.map((p) =>
    p.slot ? { ...p, slot: to(p.slot) } : p,
  );
  if (base.worked)
    base.worked.parts = base.worked.parts.map((p) =>
      p.slot ? { ...p, slot: to(p.slot) } : p,
    );
}

// A slot the browser sends: the frame's own, or one it was shown by its
// number (maskFrame).
export function slotFrom(frame: Frame, raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const valid = slotsOf(frame);
  if (valid.includes(raw)) return raw;
  const x = /^(?:Lane|Tick|Box|Column) (\d+)$/.exec(raw);
  return x ? (valid[Number(x[1]) - 1] ?? raw) : raw;
}

function reviewView(
  s: LearnState,
  nodes: Record<string, MapNode>,
  live: ReadonlySet<string>,
  now: number,
): ReviewView | null {
  const r = s.review;
  if (!r || staleReview(s, now)) return null;
  const order = r.order.filter((id) => live.has(id));
  const today = todayOf(s);
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
          // a wrong pick is final, so the right step is named then (as the
          // predict names its answer): only the chip you picked turned red
          correct: c.picked && c.picked !== c.answer ? c.answer : null,
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
    review: reviewView(s, nodes, live, now),
    last: lastVisit(s),
    topic,
  };
}

export const isSure = (v: unknown): v is Sure => SURES.includes(v as Sure);

// the last visit that rebuilt something (an empty one saved before was
// recorded as "0 of 0")
export const lastVisit = (s: LearnState) =>
  s.visits.findLast((v) => v.of > 0) ?? null;
