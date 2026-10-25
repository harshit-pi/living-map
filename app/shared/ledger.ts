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

export type LedgerView = {
  conv: string;
  title: string;
  turns: number; // turns in the chat so far
  read: number; // the last turn the map has filed
  lookedTurn: number; // the last turn when you last looked
  items: LedgerItem[]; // live items, flat; the page builds the tree by parent
  strip: {
    doing: string | null; // what Claude is on, from its task list
    waiting: string[]; // ids, oldest first
    since: { turns: number; waiting: number; changes: number };
  };
  changes: ChangeStatement[];
  spend: { calls: number; usd: number; todayUsd: number };
  health: {
    following: boolean;
    behind: number; // sealed turns not yet filed
    error?: string; // the last extraction's failure, when the next hasn't succeeded
    reading?: { done: number; total: number }; // a long chat linked late
  };
};

// What you can do from the page. Each lands as a change by "you", which
// the extractor never overwrites; answers and picks also reach the chat.
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
    };

export type LedgerEvent = { type: "ledger"; conv: string; view: LedgerView };
