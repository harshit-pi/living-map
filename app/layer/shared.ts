// The conversation layer: what every map linked to one of your Claude Code
// conversations shares, whichever view you are on (Explore, Learn, Design).
// It follows the conversation as it goes: what waits on you, what Claude is
// on, what was decided, what is still open, and the side chats you start
// from any of it. Shared by the server and the rail beside every view.

export const LAYER_ID = "follow";

// what an item on the rail stands for
export type ItemType =
  "topic" | "task" | "decision" | "question" | "option" | "note";
export const ITEM_TYPES: readonly ItemType[] = [
  "topic",
  "task",
  "decision",
  "question",
  "option",
  "note",
];

// a task is pending until it is done (or dropped), and active while Claude is
// on it; a question is open until
// answered; an option Claude offered is open until it is taken ("chosen") or
// passed over ("dropped"); the rest just are
export type ItemState =
  "pending" | "active" | "done" | "dropped" | "open" | "answered" | "chosen";

// who the next step is on: you (answer, pick, approve, do) or Claude
export type Owner = "you" | "claude";

export type Item = {
  id: string;
  // the topic it belongs to, or the question an option answers; null for a topic
  parent: string | null;
  type: ItemType;
  state?: ItemState;
  owner?: Owner;
  title: string;
  summary: string;
  // the turn of the conversation it comes from (as the rail shows it)
  turn?: number;
  // you ticked, picked or settled it: the rail keeps your word over Claude's
  byYou?: boolean;
  updatedAt: number;
  order: number;
};

// One turn of the conversation as the layer reads it: what you said, or what
// Claude answered, with tool calls and their output left out.
export type Turn = {
  n: number;
  who: "you" | "claude";
  text: string;
  ts: number;
};

export type SideLine = {
  role: "you" | "claude" | "system";
  text: string;
  ts: number;
};

// a side chat: pinned to an item (or "root", the whole conversation); it
// resumes the conversation, so it knows everything said there
export type SideChat = {
  id: string;
  on: string;
  title: string;
  createdAt: number;
  lines: SideLine[];
};

// what a view is asked when you bring it up to date from the chat: the
// map's words, not yours, so the main chat is not told them
export const REFRESH =
  "Bring this canvas up to date with what the conversation said since your last move: add what is new, settle what it settled, and leave the rest.";

export type Mode = "explore" | "learn" | "design";
export const MODES: readonly Mode[] = ["explore", "learn", "design"];

// what the browser sees
export type LayerView = {
  items: Record<string, Item>;
  // item ids by whom the next step is on, most pressing first: waiting on
  // you, Claude still to do, still to talk through, and settled (newest first)
  lanes: { you: string[]; claude: string[]; open: string[]; decided: string[] };
  sides: SideChat[];
  // the main conversation's last turn
  latest: Turn | null;
  turns: number; // your turns read so far
  mapped: number; // of them, filed on the rail
  following: boolean;
  syncedAt: number | null;
  summary: string;
  // what Claude is on now, in a few words
  now: string;
  // the view the conversation looks like it needs, and the question it is on
  suggested: { mode: Mode; question: string } | null;
  // your turns since this view's last move: it is that far behind the chat
  behind: number;
  // what the main conversation has not heard from the map yet
  unsent: number;
  // items the latest catch-up filed or changed, for a few minutes
  fresh: string[];
  // why following stopped by itself, if it did
  pausedWhy?: string;
  // the view keeps itself current (off: it waits for "Update")
  autoView: boolean;
  // a listener in the main chat is waiting: what you send wakes it now
  listening: boolean;
  // what you wrote to the main chat from the map, and whether it has heard
  told: { text: string; ts: number; heard: boolean }[];
};
