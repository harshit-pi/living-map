// What the v3 map's page sees of a chat (GET /api/ledger/view) and what it
// can do on it (POST /api/ledger/act). The server builds it from the item
// store (app/ledger/); the page draws it (app/web/map/). Change it here and
// both sides follow.

import type { Kind } from "../ledger/items.ts";

export type LedgerItem = {
  id: string;
  type: Kind;
  state: string; // a topic's is derived: waiting, active, open, done
  title: string;
  body: string;
  quote: string;
  src: number[]; // source turns
  parent: string | null;
  owner?: "you" | "claude";
  basis: "said" | "inferred" | "side";
  links: { rel: string; to: string }[];
  waiting: boolean; // waits on you
  open: boolean;
  isNew: boolean; // filed since you last looked
  // where it sits among its siblings: a fractional order key, never pixels,
  // so adding an item never moves the ones above it
  order: string;
  folded?: boolean; // a topic folded on the map
  // what you did on it last that was told to the main chat, and whether
  // the chat has taken it from its inbox yet (the hook or the listener)
  sent?: { at: number; heard: boolean };
  proposals?: number; // side-chat proposals still waiting on you
  // a wait the map closed with no quote from the chat behind it: what it
  // was, what it became and on which turn, until you settle it
  unconfirmed?: { from: string; to: string; turn: number };
};

// what changed in the system this session, one summary (see ledger/changes)
export type ChangeStatement = {
  id: string;
  change: "added" | "removed" | "changed";
  kind: string; // import-edge, dependency, module, service, port, ...
  text: string;
  module: string; // the group it is shown under
  file: string;
  turn: number;
  low: boolean; // test-only, stdlib, indirect: hidden unless asked
  review?: "expected" | "unwanted" | "unsure" | "wrong";
};

// one chat with a map, in the list the bare page shows (GET /api/ledger/chats)
export type ChatSummary = {
  conv: string;
  title: string;
  cwd: string;
  linkedAt: number;
  following: boolean;
  turns: number;
  waiting: number; // items that wait on you
};

export type LedgerView = {
  conv: string;
  title: string;
  turns: number; // turns in the chat so far
  read: number; // the last turn the map has filed
  lookedTurn: number; // the last turn when you last looked
  items: LedgerItem[]; // live items, flat; the page builds the tree by parent
  // the topic the chat is on: the one its latest filed turn belongs to
  now?: string | null;
  strip: {
    doing: string | null; // what Claude is on, from its task list
    waiting: string[]; // ids, oldest first
  };
  changes: ChangeStatement[];
  // side chats still open, oldest first: the page shows one, the rest as chips
  sides: { id: string; item: string; title: string; busy: boolean }[];
  // kept for measuring; the page doesn't show it, as Claude Code's
  // subscription covers these calls
  spend: { calls: number; usd: number; todayUsd: number };
  health: {
    following: boolean;
    behind: number; // sealed turns not yet filed
    error?: string; // the last extraction's failure, when the next hasn't succeeded
    reading?: { done: number; total: number }; // a long chat linked late
    // a run under way: which turns, since when
    filing?: { turns: number[]; since: number };
    // the last run: how long after its newest turn sealed it was filed, and
    // how much of that the model took
    lag?: { turn: number; ms: number; modelMs: number };
  };
};

// A side chat about one item (app/ledger/sides.ts): its own read-only
// Claude Code, which reads the project and rendered copies of the map and
// the chat. It never changes anything itself: what it concludes comes as
// proposals, checked against the store, that you apply or leave.
export type SideMessage = {
  role: "you" | "claude";
  text: string; // Claude's words without its proposal block
  at: number;
  tools?: string[]; // what it read on the way, e.g. "Read items.md"
  stopped?: boolean; // you stopped it, or it ended, before it finished
};

export type SideProposal = {
  id: string;
  status: "pending" | "applied" | "dropped";
  at: number; // when it came: it is shown under the reply that made it
  ops: string[]; // each change in plain words, in order
  // what the check left out, and why (unknown ids, bad states)
  dropped: { text: string; why: string }[];
};

export type SideChat = {
  id: string;
  item: string;
  title: string; // the item's title when it opened
  messages: SideMessage[]; // the reply under way is the last, while busy
  busy: boolean;
  proposals: SideProposal[];
  tokens: { input: number; output: number; usd: number }; // measured, not shown
  error?: string;
};

// What you can do from the page. Each lands as a change by "you", which
// the extractor never overwrites; answers, picks and ticks also reach the
// chat. Side-chat actions answer with the side chat as well as the view.
export type LedgerAction =
  | { type: "state"; item: string; state: string } // done, answered, taken, ...
  | { type: "not-right"; item: string } // wrong or not worth showing
  | { type: "answer"; item: string; text: string } // to the chat at once
  | { type: "fold"; item: string; folded: boolean }
  | { type: "looked" } // you have seen everything up to now
  | {
      type: "review";
      change: string;
      review: ChangeStatement["review"];
    }
  | { type: "side-open"; item: string } // the item's open side chat, or a new one
  | { type: "side-say"; side: string; text: string } // queued while it answers
  | { type: "side-stop"; side: string } // ends the answer under way
  | { type: "side-close"; side: string } // off the chips; its messages stay
  // `ops`: the indexes to apply (all when absent); checked again first
  | { type: "apply-proposal"; side: string; proposal: string; ops?: number[] }
  | { type: "drop-proposal"; side: string; proposal: string };

export type LedgerEvent =
  | { type: "ledger"; conv: string; view: LedgerView }
  // a side chat changed: streamed while it answers
  | { type: "side"; conv: string; side: SideChat };
