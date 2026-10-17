// Explore as a decision board: the options across the top, what you want down
// the side, one short judged mark in each cell. Shared by the plugin's server
// and screen. The board's state is map.data.explore; core's node map still
// holds the questions, options and facts (a want is a fact node).

export const PLUGIN_ID = "explore";

// the longest name an option or a want of yours may have: the inputs stop
// there too, so nothing you type is cut without your seeing it
export const NAME_MAX = 80;

export type Shape = "choose" | "causes" | "open";
export type Weight = "must" | "matters" | "nice";
export type Mark = "better" | "same" | "worse" | "fails" | "unknown";
export type Sure = "low" | "mid" | "high";
export type Who = "you" | "claude";
export type Survives = "yes" | "narrowly" | "no";

export const SHAPES: readonly Shape[] = ["choose", "causes", "open"];
export const WEIGHTS: readonly Weight[] = ["must", "matters", "nice"];
export const MARKS: readonly Mark[] = [
  "better",
  "same",
  "worse",
  "fails",
  "unknown",
];
export const SURES: readonly Sure[] = ["low", "mid", "high"];
export const SURVIVES: readonly Survives[] = ["yes", "narrowly", "no"];

// every mark is a symbol and a word, never colour alone
export const MARK_LOOK: Record<Mark, { symbol: string; word: string }> = {
  better: { symbol: "▲", word: "better" },
  same: { symbol: "＝", word: "same" },
  worse: { symbol: "▼", word: "worse" },
  fails: { symbol: "✕", word: "fails" },
  unknown: { symbol: "?", word: "can't tell" },
};
export const WEIGHT_WORD: Record<Weight, string> = {
  must: "Must",
  matters: "Matters",
  nice: "Nice",
};
export const SHAPE_WORD: Record<Shape, string> = {
  choose: "a choice",
  causes: "finding a cause",
  open: "an open question",
};

export type Side = {
  mark: Mark;
  note: string;
  facts: string[];
  sure: Sure;
  at: number;
};
// yours wins on the board; Claude's shows beside it
export type Cell = { you?: Side; claude?: Side };
// id = the want's fact node
export type Row = { id: string; weight: Weight; suggested: boolean; by: Who };
export type Against = {
  text: string;
  survives: Survives;
  facts: string[];
  at: number;
};
export type Assumption = {
  id: string;
  text: string;
  breaksIf: string;
  status: "untested" | "holds" | "broken";
  by: Who;
  at: number;
};
export type Step = {
  id: string;
  when: string;
  do: string;
  by: Who;
  done?: boolean;
};
export type Outcome = "expected" | "worse" | "too-soon";
export type Commit = {
  option: string;
  why: string;
  sure?: number;
  at: number;
  migrated?: boolean;
  premortem: { you?: string; claude: string[] };
  outcome?: { said: Outcome; at: number };
};

export type Board = {
  question: string;
  shape: Shape;
  shapeBy: Who;
  keepAsIs?: string;
  rows: Row[]; // display order
  cells: Record<string, Cell>; // `${option}|${row}`
  against: Record<string, Against[]>; // newest last
  lean?: { option: string; sure?: number; at: number };
  commit?: Commit;
  assumptions: Assumption[];
  steps: Step[];
  // you kept, skipped, added or weighted a want before the first Fill
  criteriaTouched: boolean;
  filledAt?: number;
};
export type Stand = {
  lead: string | null;
  line: string;
  sure?: number;
  at: number;
  migrated?: boolean;
};

export type ExploreState = {
  v: 1;
  boards: Record<string, Board>; // by question id
  stand: Record<string, Stand>; // by question id
  answers: Record<string, { text: string; by: Who; at: number }>;
  takeaways: Record<string, { text: string; at: number }>;
  // the options you added: core marks those you choose or set aside as
  // yours too, so this is what "you" on a column means
  added: Record<string, true>;
};

export const cellKey = (option: string, row: string) => `${option}|${row}`;

// ---- what the browser sees (view): computed on the server, read as is

export type ShownCell = {
  mark: Mark;
  note: string;
  facts: string[];
  // Claude's mark with no fact behind it, or one it is not sure of
  guess: boolean;
  who: Who;
  // Claude's side, when yours is the one shown
  claude?: Side;
};

export type Tally = {
  mustsMet: number;
  musts: number;
  better: number;
  same: number;
  worse: number;
  fails: number;
  unknown: number;
  // musts with no mark yet
  empty: number;
  // musts marked fails: the option misses them, so it is out
  mustsFailed: number;
  failsMust: boolean;
};

export type ColumnView = {
  id: string;
  title: string;
  summary: string;
  keepAsIs: boolean;
  lead: boolean;
  lean: boolean;
  chosen: boolean;
  // set aside by a Choose: kept in place, faded
  faded: boolean;
  failsMust: boolean;
  by: Who;
  threads: number;
  takeaway?: string;
  against?: Against;
  was: Against[];
  tally: Tally;
};

export type RowView = {
  id: string;
  title: string;
  weight: Weight;
  by: Who;
  suggested: boolean;
};

export type GroupView = {
  weight: Weight;
  rows: RowView[];
  folded: boolean;
  // an empty or guess cell on a live column in this group
  gap: boolean;
};

export type BoardView = {
  question: string;
  title: string;
  shape: Shape;
  shapeBy: Who;
  keepAsIs: string | null;
  // the board's questions from the root down, for the breadcrumb
  path: { id: string; title: string }[];
  columns: ColumnView[]; // keep-as-is first
  aside: ColumnView[]; // set aside by you: the drawer
  groups: GroupView[];
  suggestions: RowView[];
  cells: Record<string, ShownCell>;
  lean: { option: string; sure?: number; at: number } | null;
  commit: Commit | null;
  assumptions: Assumption[];
  steps: Step[];
  criteriaTouched: boolean;
  filledAt: number | null;
  // a choice with no list of what you want yet (an older map)
  needsWants: boolean;
  settled: boolean;
  // what Next does when this is the board you are on
  next: Gap;
};

export type StandView = Stand & { stale: boolean };

export type RootState = "decided" | "leaning" | "open";

export type DecisionPoint = {
  id: string;
  title: string;
  shape: Shape;
  depth: number;
  settled: boolean;
  // no chosen option yet, or proposed ones left beside it (choose); not
  // settled on its own (causes, open), whatever is under it
  open: boolean;
  // the title of a set-aside node above it: hiding set-aside nodes never
  // hides open work
  underAside?: string;
};

export type Rollup = {
  state: RootState;
  settled: number;
  total: number;
  points: DecisionPoint[];
};

export type OpenKind =
  | "empty-must"
  | "guess-must"
  | "choice"
  | "question"
  | "no-against"
  | "no-premortem"
  | "broken";

export type OpenItem = {
  kind: OpenKind;
  count: number;
  label: string;
  // where the first of them is
  q: string;
};

export type GapKind =
  "fill" | "something" | "ask" | "against" | "wrap" | "question" | "sum";

export type Gap = {
  kind: GapKind;
  q: string;
  option?: string;
  want?: string;
  label: string;
  reason: string;
};

export type QuestionView = {
  id: string;
  title: string;
  shape: Shape;
  settled: boolean;
  board: boolean;
  answer: { text: string; by: Who } | null;
  gaps: number;
  underAside?: string;
};

export type ExploreView = {
  root: string | null;
  defaultView: "board" | "tree";
  boards: Record<string, BoardView>;
  stand: Record<string, StandView>;
  rollup: Rollup;
  open: OpenItem[];
  questions: QuestionView[];
  next: Gap;
  looseFacts: { id: string; title: string }[];
  outcomeDue: {
    q: string;
    option: string;
    title: string;
    sure?: number;
    at: number;
  }[];
};
