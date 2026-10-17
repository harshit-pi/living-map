// The shapes the server and the browser share: what a map looks like on the
// wire, the actions the browser can send, and the events the server pushes.
// Both sides import this file, so the two can never drift apart.

export type Kind = "question" | "option" | "fact";
export type Status =
  "open" | "answered" | "proposed" | "chosen" | "dropped" | "info";
// a mode is a plugin, by its id: "explore", "learn", "design", …
export type Purpose = "explore" | "learn" | (string & {});
// How Claude should shape a reply: a caption for the canvas, or a short chat answer in a side thread
export type View = "visual" | "thread";

export type MapNode = {
  id: string;
  parent: string | null;
  kind: Kind;
  title: string;
  summary: string;
  detail: string;
  status: Status;
  by: "claude" | "you";
  updatedAt: number;
  order: number;
  dropped?: boolean;
  fresh?: boolean;
  revealed?: boolean;
  // set when the node stands for a part of the topic diagram you clicked
  anchor?: string;
};

export type ChatLine = {
  role: "you" | "claude" | "system";
  text: string;
  ts: number;
  view?: View;
  // a reply that checks a blank: it is shown on the blank, not as a caption
  blankId?: string;
  // a main-conversation reply about one node (a hint, going deeper): it
  // belongs with that node, not with the map's next step
  nodeId?: string;
};
export type Thread = {
  id: string;
  nodeId: string;
  title: string;
  createdAt: number;
  messages: ChatLine[];
};

// ---- the topic diagram (Learn). A blank has `blank: true`, a `prompt`, and no answer.

type Blankable = {
  id: string;
  blank?: boolean;
  prompt?: string;
  filled?: boolean;
};
export type SeqStep = Blankable & { from: string; to: string; label: string };
export type ConceptNode = Blankable & { label: string; note?: string };
export type Link = { from: string; to: string; label: string };
export type TimeEvent = Blankable & {
  when: string;
  label: string;
  note?: string;
};
export type Box = Blankable & { label: string; rows?: string[] };
export type Cell = Blankable & { text: string };
export type Diagram =
  | { form: "sequence"; title: string; lanes: string[]; steps: SeqStep[] }
  | { form: "concept"; title: string; nodes: ConceptNode[]; links: Link[] }
  | { form: "timeline"; title: string; events: TimeEvent[] }
  | { form: "structure"; title: string; boxes: Box[]; arrows: Link[] }
  | {
      form: "grid";
      title: string;
      columns: string[];
      rows: { label: string; cells: Cell[] }[];
    };
export type DiagramForm = Diagram["form"];
export type Fill = { text: string; state: "pending" | "right" | "wrong" };

// ---- playable scenes, as the browser sees them: the state now and the move in
// front of you. The answers stay on the server.

export type SceneKind = "board" | "array" | "tree";
export type Tone = "focus" | "attack" | "good" | "bad" | "path" | "dim";
export type BoardState = {
  cells: string[][];
  marks: { at: [number, number]; tone: Tone }[];
  note: string;
};
export type ArrayState = {
  items: string[];
  pointers: { name: string; at: number }[];
  marks: { at: number; tone: Tone }[];
  note: string;
};
export type TreeState = {
  nodes: { id: string; label: string; parent: string | null }[];
  marks: { at: string; tone: Tone }[];
  note: string;
};
export type SceneState = BoardState | ArrayState | TreeState;
export type AnswerType = "cell" | "index" | "node" | "choice" | "text";
export type MoveFeedback = {
  ok: boolean;
  text: string;
  shown?: boolean;
  key?: string;
};
export type Scene = {
  kind: SceneKind;
  title: string;
  total: number;
  at: number;
  done: boolean;
  waiting: boolean;
  state: SceneState;
  ask: string;
  choices: string[];
  answerType: AnswerType | null;
  last: MoveFeedback | null;
  wrong: number;
  shown: number;
};

export type Usage = {
  turns: number;
  input: number;
  output: number;
  costUsd: number;
  last: {
    input: number;
    output: number;
    costUsd: number;
    ms: number;
    firstMs?: number;
    model?: string;
    effort?: string;
  } | null;
};

// A map as the browser receives it.
export type MapDoc = {
  id: string;
  title: string;
  purpose: Purpose;
  nodes: Record<string, MapNode>;
  chat: ChatLine[];
  threads: Record<string, Thread>;
  diagram: Diagram | null;
  diagramAt?: number;
  fills: Record<string, Fill>;
  scenes: Record<string, Scene>;
  usage: Usage;
  // each plugin's own state, by plugin id, as the plugin chooses to show it
  data?: Record<string, unknown>;
};

export type MapSummary = {
  id: string;
  title: string;
  purpose: Purpose;
  updatedAt: number;
  nodes: number;
  open: number;
  done: number;
  current: boolean;
  // a mode's own one-line summary, e.g. "7 parts · 6 wires"
  summary?: string;
};

// What Claude is doing now, and what waits its turn.
export type Working = {
  label: string;
  nodeId: string | null;
  threadId: string | null;
  // set while a blank is being checked; its verdict appears on the blank
  blankId: string | null;
  since: number;
};
export type Waiting = { label: string; nodeId: string | null };

export type Settings = { model: string; effort: string };

// The model behind the canvas, as the pickers show it.
export type Choice = { id: string; label: string };
export type ProviderInfo = {
  name: string;
  models: Choice[];
  efforts: Choice[];
};

// ---- actions the browser sends --------------------------------------------------

export type NodeAction =
  | "choose"
  | "drop"
  | "restore"
  | "deeper"
  | "challenge"
  | "explain"
  | "hint"
  | "answer"
  | "scene"
  | "playshow"
  | "replay";

// what Show answer says in the step's thread; the panel uses it to tell that
// the answer is already there
export const ASK_ANSWER = "Show me the answer.";

export type Action =
  | { type: "new"; text: string; purpose: Purpose }
  | { type: NodeAction; nodeId: string; threadId?: string }
  | { type: "thread"; nodeId: string; threadId?: string; text: string }
  | { type: "fork"; nodeId: string }
  | { type: "fill"; blankId: string; text: string }
  | { type: "message"; text: string; selection: string[] }
  | { type: "purpose"; purpose: Purpose }
  | { type: "next" | "stop" }
  | { type: "open"; mapId: string }
  | { type: "focus"; anchor: string; label: string }
  | { type: "play"; nodeId: string; key: string }
  // an action a plugin defines: its id, the action's name and its arguments
  | {
      type: "plugin";
      plugin: string;
      name: string;
      args?: Record<string, unknown>;
    };

export type ActionRequest = Action & { settings?: Partial<Settings> };
export type ActionResult = {
  // the move was stopped, or cancelled before it ran (not an error to show)
  stopped?: boolean;
  error?: string;
  threadId?: string;
  ok?: boolean;
  nodeId?: string;
};

// ---- events the server pushes ----------------------------------------------------

// The running version, the latest release, and whether a one-click update can run.
export type UpdateInfo = {
  current: { version: string; sha: string };
  latest: {
    version: string;
    notes: string;
    url: string;
    publishedAt: string;
  } | null;
  available: boolean; // the latest release is ahead of what runs here
  behind: number; // commits between here and the latest release
  canUpdate: boolean;
  reason: string; // why an update cannot run here, if it cannot
  restarts: boolean; // the launcher restarts the app after an update
};
export type UpdateStep = {
  step: string;
  state: "running" | "done" | "failed";
  message?: string;
};

export type ServerEvent =
  | {
      type: "map";
      map: MapDoc | null;
      busy: boolean;
      working: Working | null;
      queued: number;
      waiting: Waiting[];
    }
  | {
      type: "busy";
      busy: boolean;
      threadId: string | null;
      working: Working | null;
    }
  | { type: "delta"; text: string; threadId: string | null }
  | { type: "ping" }
  | ({ type: "update" } & UpdateStep);
