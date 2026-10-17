// Explore as a decision board: the options across the top, what you want down
// the side, one short judged mark in each cell. Shared by the plugin's server
// and screen. The board's state is map.data.explore; core's node map still
// holds the questions, options and facts (a want is a fact node).

export const PLUGIN_ID = "explore";

// the longest name an option or a want of yours may have: the inputs stop
// there too, so nothing you type is cut without your seeing it
export const NAME_MAX = 80;
// past the limit a name is not sent: the screen says how much to cut
export const tooLong = (text: string) => text.trim().length > NAME_MAX;

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
// On a must a mark says whether it is met (the tally counts better and same
// as met), so "same" reads "meets": "same" beside a baseline that cannot
// tell compared with nothing you could see.
export const markWord = (mark: Mark, must = false) =>
  must && mark === "same" ? "meets" : MARK_LOOK[mark].word;
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
  // Claude judged this cell on its own, in a thread (an Ask or a reply): a
  // guess it left is one it could not settle, so Next does not ask again
  // until a newer fact is on the board
  checked?: boolean;
};
// yours wins on the board; Claude's shows beside it
export type Cell = { you?: Side; claude?: Side };
// id = the want's fact node
export type Row = {
  id: string;
  weight: Weight;
  suggested: boolean;
  by: Who;
  // when Claude last judged this row in its own thread, on what you told it
  // there: a "can't tell" after that is one you have already answered, so
  // Next no longer sends you to say what you know
  told?: number;
};
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
  // when Claude wrote it (older maps have none): one older than the choice
  // was about an earlier one
  at?: number;
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

// a Fill's labels, from its button and from Next: the board's Fill button
// knows one is on its way by them
export const FILLING_LABEL = "Filling the board";
export const FILL_LABEL = "Fill the board";

// What the first move lays out, by the shape the question has: the label
// of the move that frames it, which the screen also knows it by
export const LAYING_OUT: Record<Shape, string> = {
  choose: "Laying out the board",
  causes: "Laying out the causes",
  open: "Laying out the question",
};

// A question that asks for causes, read from its words before Claude frames
// it: "Why did…", and "What could explain…", "What caused…", "What is
// behind…", which read as a choice until the frame op landed.
export const ASKS_CAUSES =
  /^\s*(why\b|how come\b|what\s+(could|might|would|can|may)?\s*(explains?|caused?|causes|is causing|be causing|be behind|is behind|drove|is driving|led to)\b|what('s|\s+is)\s+(causing|behind|driving)\b)/i;

export const cellKey = (option: string, row: string) => `${option}|${row}`;

// A check still to run is not a fact: Claude starts its summary "To check:",
// and older maps phrase it as an instruction ("Split churn by cohort"). It
// shows as one on the Tree, and is no loose fact on the board.
const CHECK =
  /^\s*(to check:|(check|compare|split|break\b.*\bdown|match|measure|look (at|for|up|into)|pull|test|find out|segment|verify|confirm)\b)/i;
// A check once run says what it found ("Found: …", as the prompt and
// answerChecks write it): it is a fact now, even when its title is still
// the instruction ("Split time by stage"), which kept it a check to run.
const FOUND = /^\s*found:/i;
export const isCheck = (n: { kind: string; title: string; summary: string }) =>
  n.kind === "fact" &&
  !FOUND.test(n.summary) &&
  (CHECK.test(n.summary) || CHECK.test(n.title));

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
  // cells with no mark yet, on any want: told apart from "?" (Claude can't
  // tell), which is a mark
  blank: number;
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
  // messages in its side threads
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
  // one Fill is the step: most of the board is still empty (core's needsFill)
  needsFill: boolean;
  // must cells still empty on the options in play: Fill stays while any is
  emptyMusts: number;
  settled: boolean;
  // what Next does when this is the board you are on
  next: Gap;
  // the facts on this choice (none under a question below it) that back no
  // cell yet
  looseFacts: { id: string; title: string }[];
};

export type StandView = Stand & {
  stale: boolean;
  // the board scores another option higher on the musts than Claude's lead
  // (or has the lead failing one): said beside its line
  boardSays?: string;
};

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
  | "chosen-unsure"
  | "broken";

export type OpenItem = {
  kind: OpenKind;
  count: number;
  label: string;
  // where the first of them is
  q: string;
};

// "run", "tell", "open" and "settle" are yours, not Claude's: a check
// Claude picked to run first, which Next opens (its thread is where you say
// what it found); a must Claude cannot tell without you, whose want Next
// opens; a choice with its own board, which Next opens; a cause list whose
// likely cause Claude's last word agrees with, whose question Next opens to
// settle
export type GapKind =
  | "fill"
  | "something"
  | "ask"
  | "against"
  | "wrap"
  | "question"
  | "open"
  | "settle"
  | "run"
  | "tell"
  | "sum";

// Next's gaps you act on yourself: pressing Next pays for no move
export const YOURS: ReadonlySet<GapKind> = new Set([
  "run",
  "tell",
  "open",
  "settle",
]);

export type Gap = {
  kind: GapKind;
  q: string;
  // the option; for "run" the check; for a causes question, the finding
  // Next has Claude weigh
  option?: string;
  // the want ("ask", and for "tell" the one Next opens)
  want?: string;
  // for "tell", the check still to run the cells wait on: Next opens it,
  // where you answer it, rather than the want
  check?: string;
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
  // empty cells on its board
  gaps: number;
  underAside?: string;
  // the check Claude said to run first (causes), until something newer is
  // under the question
  runFirst?: { id: string; why: string };
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
  // the want nodes: the board's rail shows them, so the Tree leaves them out
  wants: string[];
  outcomeDue: {
    q: string;
    option: string;
    title: string;
    sure?: number;
    at: number;
  }[];
};
