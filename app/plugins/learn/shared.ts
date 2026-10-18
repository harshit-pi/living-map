// Learn, Build It Back: each step is a small model of the subject (parts,
// typed links, a frame) drawn on one concrete case. You see it once, it is
// hidden, and you build it back; the server checks the build with no model
// call. Shared by the plugin's server and screen: the verbs, the frames, the
// help levels, and what the browser is sent (LearnView), never the answers.

export const PLUGIN_ID = "learn";

// ---------------------------------------------------------------- verbs

// The closed list of link verbs, in families. A verb from the same family on
// the right pair is half right (never a pass for a key link); `stem` is what
// the giveaway check looks for in a text ("becom" catches "become").
export const FAMILIES = {
  // raises and lowers say which way a quantity moves: with "causes" alone,
  // "8% price rise causes Real value" left out the whole point (it lowers
  // it), and a learner who drew it with "prevents" for "cuts" was marked ~
  cause: ["causes", "enables", "prevents", "activates", "raises", "lowers"],
  change: ["becomes", "makes"],
  structure: ["part of", "kind of", "contains"],
  flow: [
    "sends to",
    "then",
    "reads",
    "writes",
    "calls",
    "shows to",
    "picked up by",
  ],
  contrast: ["unlike"],
} as const;

export type Family = keyof typeof FAMILIES;
export type Verb = (typeof FAMILIES)[Family][number];

export const VERBS: readonly Verb[] = Object.values(FAMILIES).flat();

export const isVerb = (v: unknown): v is Verb =>
  typeof v === "string" && (VERBS as readonly string[]).includes(v);

export function familyOf(v: Verb): Family {
  for (const [f, verbs] of Object.entries(FAMILIES))
    if ((verbs as readonly string[]).includes(v)) return f as Family;
  return "flow";
}

export const STEMS: Record<Verb, string> = {
  causes: "caus",
  enables: "enabl",
  prevents: "prevent",
  activates: "activat",
  raises: "rais",
  lowers: "lower",
  becomes: "becom",
  makes: "mak",
  "part of": "part of",
  "kind of": "kind of",
  contains: "contain",
  "sends to": "send",
  then: "then",
  reads: "read",
  writes: "writ",
  calls: "call",
  "shows to": "show",
  "picked up by": "pick",
  unlike: "unlike",
};

// ---------------------------------------------------------------- frames

export type FrameKind = "free" | "lanes" | "axis" | "boxes" | "sort";
export const FRAME_KINDS: readonly FrameKind[] = [
  "free",
  "lanes",
  "axis",
  "boxes",
  "sort",
];

export type Frame =
  | { kind: "free" }
  | { kind: "lanes"; lanes: string[] }
  | { kind: "axis"; ticks: string[] }
  | { kind: "boxes"; boxes: { id: string; label: string }[] }
  | { kind: "sort"; columns: string[] };

// Each frame allows only the verbs its shape can mean: a timeline links by
// cause and order, a box diagram by what holds what (and what one part
// makes of another: a hash function makes a hash code, and a model that said
// so lost the link and with it its predict).
export const FRAME_FAMILIES: Record<FrameKind, readonly Family[]> = {
  free: ["cause", "change", "structure", "flow", "contrast"],
  lanes: ["flow", "cause", "change"],
  axis: ["cause", "flow", "change"],
  boxes: ["structure", "flow", "cause", "change"],
  sort: ["cause", "contrast", "structure"],
};

export const verbsFor = (kind: FrameKind): Verb[] =>
  FRAME_FAMILIES[kind].flatMap((f) => [...FAMILIES[f]]);

// the slots a part may sit in: a lane, a tick, a box id or a column
export function slotsOf(frame: Frame): string[] {
  switch (frame.kind) {
    case "lanes":
      return frame.lanes;
    case "axis":
      return frame.ticks;
    case "boxes":
      return frame.boxes.map((b) => b.id);
    case "sort":
      return frame.columns;
    default:
      return [];
  }
}

// The order is what an axis frame is about (a play step's subgoals): a pair
// out of order, or a part not on a tick, stops a pass. On any frame a part
// left outside it stops a pass too (core's placement); which lane, box or
// sort column it sits in is marked and does not.
export const orderStops = (f: Frame): boolean => f.kind === "axis";

// Where a part sits is what the step asks, on every frame: on an axis its
// place in the order, in sort columns the claim it is weighed as, in lanes
// and boxes which one it belongs in (a sort step at L1 put every picking
// rule in its own traffic column, the answer before a link was drawn, and a
// lanes or boxes step put each part in its own lane or box). At L1 these
// parts wait outside the frame for you to put in.
export const placingIsAnswer = (f: Frame): boolean => f.kind !== "free";

// A play step's model is the method's subgoal order, the same on any input,
// and a parts step's is the system's cast, the same in any case: a new case
// of either can only be the original renamed, which the shape check refuses,
// so it is not offered (two paid moves ended "did not hold together"; on
// "What does Dijkstra keep track of?" four did, each try the same lists and
// queue under new names).
export const offersCase = (m: {
  mode: "build" | "play";
  layer: Layer;
}): boolean => m.mode !== "play" && m.layer !== "parts";

// Whether a step counts as built on a build map: answered (its build passed
// and its Why was done) and built here. A step answered on the topic diagram
// before Practise this as builds is answered too, and the path read "1 of 4
// built" over four steps that all said "to do".
export const countsBuilt = (
  status: string | undefined,
  rungs: { built: unknown } | undefined,
): boolean => status === "answered" && !!rungs?.built;

// Whether a step has a New case rung to show: one it offers, or one written
// or built before it stopped being offered. The pills read "New case ○" on a
// play step that never offered one.
export const showsCase = (st: {
  mode: "build" | "play";
  layer: Layer;
  newCase: string;
  rungs: { case: unknown };
}): boolean => offersCase(st) || !!st.rungs.case || st.newCase === "ready";

export type Layer = "parts" | "behaviour" | "function" | "failure";
export const LAYERS: readonly Layer[] = [
  "parts",
  "behaviour",
  "function",
  "failure",
];

// ---------------------------------------------------------------- help

// The fading ladder: how much of the model is given when you build it.
export type Help = 0 | 1 | 2 | 3;
export const HELP: Record<Help, { name: string; says: string }> = {
  0: {
    name: "Fill the gaps",
    says: "All parts placed, every link but the key ones drawn",
  },
  1: { name: "Link it", says: "All parts placed, no links" },
  2: { name: "Place and link", says: "The frame, the parts in the tray" },
  3: { name: "From the frame", says: "You type each part into the frame" },
};

// the level chooser, once per map: where the first visit's help starts
export type Level = "new" | "some" | "cold";
export const LEVEL_HELP: Record<Level, Help> = { new: 0, some: 1, cold: 2 };

export type Stage = "see" | "build" | "why" | "built";

// a review's due steps come back shuffled; from this many they are never in
// path order (two may come back as they were, so nothing promises a mix)
export const MIXED_FROM = 3;
// kept apart everywhere: only "you" moves a review item up a box
export type Credit = "you" | "hints" | "shown";
export type Sure = "guess" | "fairly" | "sure";
export const SURES: readonly Sure[] = ["guess", "fairly", "sure"];
// fixed: right after a check said it was not, with no hint taken (the
// schedule treats it as hinted: only unaided moves an item up)
export type How = "unaided" | "hinted" | "fixed" | "shown" | "wrong";
export type Rung = "built" | "why" | "whatif" | "case" | "kept";
export const RUNGS: readonly Rung[] = [
  "built",
  "why",
  "whatif",
  "case",
  "kept",
];
export type WhyState = "right" | "partial" | "wrong" | "shown";

// ---------------------------------------------------------------- a check

// right · reversed (the right pair the wrong way) · family (the right pair,
// another verb: half credit) · miscon (a known misconception) ·
// extra (not in Claude's model: never wrong, and you may argue for it)
export type Mark = "right" | "reversed" | "family" | "miscon" | "extra";

// The marks you may argue against: a link not in Claude's model, one that
// matched a misconception's pattern (a fair causal link in history was
// marked ✗ with no way to say why it holds, as the pattern was wider than
// the claim), and the right pair with another verb (the verbs are a closed
// list, so "prevents" for "cuts" was a verb guess with no way to say what it
// meant). Claude's verdict decides; an accepted one is right from then.
export const ARGUABLE: readonly Mark[] = ["extra", "miscon", "family"];

export type LinkMark = {
  // your link's id
  link: string;
  mark: Mark;
  // a misconception's refutation, once you drew it
  refute?: string;
  // why the arrow points the other way, once you reversed it
  note?: string;
};

// Counts and places, never the fix.
export type CheckResult = {
  at: number;
  help: Help;
  // only the key links were graded (L0, and a quick rebuild)
  keyOnly: boolean;
  // reference links that count here, and how they came out
  total: number;
  right: number;
  // links you argued for, Claude accepted and you drew: right, on top of total
  argued: number;
  // what a pass needs of the other (non-key) links, and how many you have
  rest: number;
  restGot: number;
  restNeed: number;
  given: number;
  missing: number;
  keys: number;
  keyRight: number;
  keyMissing: number;
  // your links that are not right, by kind
  reversed: number;
  family: number;
  miscon: number;
  extra: number;
  // right + half of family, over total
  score: number;
  marks: LinkMark[];
  // lanes, boxes and sort: each part placed in a slot, and whether it is
  // one of its slots; axis: pairs out of order. On an axis the order is
  // what you build, so a pair out of order stops a pass.
  slots: { part: string; ok: boolean }[];
  outOfOrder: number;
  // parts placed outside the frame ("Not in a column yet"): not placed yet,
  // rather than in the wrong slot (absent on a check saved before)
  loose?: number;
  // refutations brought back for an item you got wrong while sure last time
  refutes: string[];
  pass: boolean;
};

// ---------------------------------------------------------------- the view

export type PartView = { id: string; label: string; role: string };
export type PlacedView = PartView & {
  x: number;
  y: number;
  slot?: string;
  // the order it came into its slot, which it keeps there
  n?: number;
};
export type LinkView = {
  id: string;
  from: string;
  to: string;
  rel: Verb;
  given?: true;
};

export type HintView = {
  rung: 1 | 2 | 3;
  // rung 1 (where): one end of the link, by label; rung 2 (ask): Claude's
  // question; rung 3 (ghost): both ends, the verb left for you to pick
  text: string;
  from?: string;
  to?: string;
};

export type StepView = {
  step: string;
  title: string;
  // 0 for a step on the path, 1 for a "Go deeper" step under it
  depth: number;
  parent: string | null;
  model: "none" | "writing" | "ready" | "broken";
  stage: Stage;
  help: Help;
  mode: "build" | "play";
  layer: Layer;
  caseTitle: string;
  case: string;
  frame: Frame;
  verbs: Verb[];
  // the parts not yet placed, shuffled; at L3 no labels (trayCount only)
  tray: PartView[];
  trayCount: number;
  // the worked case: only while you see it, or after Show the model
  worked: {
    // a part's slot in the frame is shown with the worked case (not the
    // hidden part's: that would point at the predict answer)
    parts: (PartView & { slot?: string })[];
    links: LinkView[];
    hidden: string | null;
  } | null;
  // your build, the last check and the hints you took
  placed: PlacedView[];
  links: LinkView[];
  check: CheckResult | null;
  checks: number;
  // rebuilt after Show the model: not a first try, so no "Stuck? Peek"
  viaModel?: boolean;
  // the model's key links, counted, while there is a build
  keys?: number;
  sure: Sure | null;
  hints: HintView[];
  canHint: boolean;
  // the next hint is on where a part sits, not on a link: Show one place
  hintOn?: "place";
  // you changed a link or moved a part since the last check
  changed?: boolean;
  // key links a reply of Claude's named while you built (Explain, the thread,
  // the message box): they count as hinted
  told: number;
  // a typed part that matched nothing: "did you mean" from Claude's labels
  typed: { text: string; suggest: string[] } | null;
  predict: {
    ask: string;
    choices: string[];
    picked: string | null;
    sure: Sure | null;
    right: boolean | null;
    refute: string | null;
    // the right choice, sent only once you picked a wrong one
    correct?: string;
  } | null;
  why: {
    ask: string;
    link: { from: string; to: string; rel: Verb } | null;
    state: WhyState | null;
    say: string;
    tries: number;
    // the server's own check, before any model call ("Say a little more.")
    pre: string;
  } | null;
  whatif: {
    ask: string;
    fails: string;
    // its review item is due: asked again on the built step
    due: boolean;
    result: {
      found: string[];
      // named once you have tried
      missed: string[];
      extra: string[];
      why: string;
    } | null;
  } | null;
  // a new case you are building, or one Claude is writing
  onCase: boolean;
  newCase: "none" | "writing" | "ready" | "broken";
  argued: {
    from: string;
    to: string;
    rel: Verb;
    holds: boolean;
    say: string;
    // accepted as another verb for a link of Claude's own: it counts for
    // that link from the next check
    pair?: true;
  }[];
  rungs: Record<Rung, Credit | null>;
  // a quick rebuild waiting (in-session spacing), or one under way
  recallDue: boolean;
  recall: boolean;
  // how the quick rebuild came out, once it passed
  recalled: { credit: Credit; tries: number } | null;
  reviewing: boolean;
  // this review's help is one more than the items earn: the quick rebuild
  // before it needed a second check
  lowered: boolean;
  itemsDue: number;
};

export type ReviewView = {
  at: number;
  // days since the visit before, or null on the first
  since: number | null;
  // the due steps, in mixed order
  order: string[];
  // today, unaided: n of m key links
  unaided: number;
  of: number;
  // per step, once its rebuild is checked: last time → today
  items: { step: string; label: string; last: How | null; today: How }[];
  // "Which idea is this?" once the rebuilds are done (3+ built steps)
  cards: {
    id: string;
    ask: string;
    choices: { step: string; title: string }[];
    picked: string | null;
    right: boolean | null;
    // the step it was, once you picked another
    correct: string | null;
  }[];
};

export type LearnView = {
  mode: "build";
  // the server's time when this view was made: the review clock may run
  // ahead of the browser's (LIVING_MAP_CLOCK_SKEW_DAYS), so "next in 4 days"
  // is counted from here
  now: number;
  level: Level | null;
  steps: StepView[];
  due: { now: number; next: number | null };
  review: ReviewView | null;
  // the last finished visit's score, for the headline
  last: { at: number; unaided: number; of: number } | null;
  // the old topic diagram is still on the map (Practise this as builds)
  topic: boolean;
};
