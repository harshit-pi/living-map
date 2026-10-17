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
  cause: ["causes", "enables", "prevents", "activates"],
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
// cause and order, a box diagram by what holds what.
export const FRAME_FAMILIES: Record<FrameKind, readonly Family[]> = {
  free: ["cause", "change", "structure", "flow", "contrast"],
  lanes: ["flow", "cause", "change"],
  axis: ["cause", "flow", "change"],
  boxes: ["structure", "flow", "cause"],
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
  3: { name: "From the frame", says: "The frame only: you type the parts" },
};

// the level chooser, once per map: where the first visit's help starts
export type Level = "new" | "some" | "cold";
export const LEVEL_HELP: Record<Level, Help> = { new: 0, some: 1, cold: 2 };

export type Stage = "see" | "build" | "why" | "built";
// kept apart everywhere: only "you" moves a review item up a box
export type Credit = "you" | "hints" | "shown";
export type Sure = "guess" | "fairly" | "sure";
export const SURES: readonly Sure[] = ["guess", "fairly", "sure"];
export type How = "unaided" | "hinted" | "shown" | "wrong";
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

// right · reversed (the right pair the wrong way) · family (the right pair, a
// verb from the same family: half credit) · miscon (a known misconception) ·
// extra (not in Claude's model: never wrong, and you may argue for it)
export type Mark = "right" | "reversed" | "family" | "miscon" | "extra";

// The marks you may argue against: a link not in Claude's model, and one
// that matched a misconception's pattern (a fair causal link in history was
// marked ✗ with no way to say why it holds, as the pattern was wider than
// the claim). Claude's verdict decides; an accepted one is right from then.
export const ARGUABLE: readonly Mark[] = ["extra", "miscon"];

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
  // lanes, boxes and sort: each placed part's slot; axis: pairs out of order
  slots: { part: string; ok: boolean }[];
  outOfOrder: number;
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
  // what went wrong when Claude's model did not hold together
  problems: string[];
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
  sure: Sure | null;
  hints: HintView[];
  canHint: boolean;
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
  }[];
  rungs: Record<Rung, Credit | null>;
  // a quick rebuild waiting (in-session spacing), or one under way
  recallDue: boolean;
  recall: boolean;
  reviewing: boolean;
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
