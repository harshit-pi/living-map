// Chat: a live map of one of your Claude Code conversations. The map follows
// it as it goes: what it is about (topics), what is still to do (tasks), what
// was decided and what is still open, and the side chats you start from any
// of them. Shared by the plugin's server and screen.

export const PLUGIN_ID = "chat";

// what a node on the map stands for
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

// a task is pending until it is done (or dropped); a question is open until
// answered; an option Claude offered is open until it is taken ("chosen") or
// passed over ("dropped"); the rest just are
export type ItemState =
  "pending" | "done" | "dropped" | "open" | "answered" | "chosen";

export type Item = {
  type: ItemType;
  state?: ItemState;
  // the turn of the conversation it comes from (1-based, as the map shows it)
  turn?: number;
  // you ticked or reopened it on the map: the map keeps your word over Claude's
  byYou?: boolean;
};

// One turn of the conversation as the map reads it: what you said, or what
// Claude answered, with tool calls and their output left out.
export type Turn = {
  n: number;
  who: "you" | "claude";
  text: string;
  ts: number;
};

// what the browser sees
export type ChatView = {
  items: Record<string, Item>;
  // the last few turns of the main conversation, newest last
  recent: Turn[];
  turns: number; // turns read so far
  mapped: number; // turns the map has been brought up to
  following: boolean;
  syncedAt: number | null;
  summary: string;
  // what the main conversation has not heard from the map yet
  unsent: number;
  // nodes the latest catch-up filed or changed, for a few minutes
  fresh: string[];
};
