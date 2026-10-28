// The items the map files from a chat: what was asked, offered, decided and
// left to do, each with the turn it came from and a quote that proves it.
// Phase 2 keeps them in memory; the store (SQLite) comes in phase 3 with the
// same shapes.

import type { MapItem } from "./mermaid.ts";

export const KINDS = [
  "topic",
  "question",
  "option",
  "decision",
  "task",
  "ask",
  "assumption",
  "finding",
] as const;
export type Kind = (typeof KINDS)[number];

// the states each kind may be in; the first is where a new one starts. A
// topic's state is derived from its items (topicState), never filed.
export const STATES: Record<Kind, readonly string[]> = {
  topic: [""],
  question: ["open", "answered", "dropped"],
  option: ["offered", "taken", "dropped"],
  decision: ["decided", "reopened"],
  task: ["to-do", "doing", "done", "dropped"],
  ask: ["waiting", "done", "dropped"],
  assumption: ["assumed", "confirmed", "struck"],
  finding: ["said"],
};

// Who set a field, highest first: what you did on the map beats what Claude
// Code's own task list says, which beats what the extractor read.
export const WRITERS = ["you", "claude-code", "side", "extractor"] as const;
export type Writer = (typeof WRITERS)[number];
export const outranks = (a: Writer, b: Writer) =>
  WRITERS.indexOf(a) < WRITERS.indexOf(b);

export type Field = "state" | "title" | "body" | "owner" | "parent";

export type Item = {
  id: string; // i<n>, minted here, never by a model
  type: Kind;
  state: string;
  title: string;
  body: string;
  quote: string; // words copied from one of its source turns
  src: number[]; // source turns, oldest first
  parent: string | null;
  owner?: "you" | "claude";
  // said in the chat, inferred from it, or concluded by a side chat
  basis: "said" | "inferred" | "side";
  links: { rel: string; to: string }[];
  writers: Partial<Record<Field, Writer>>;
  retired?: string; // why, when it was filed wrongly or merged
  // a wait the extractor closed with no quote from the chat behind it:
  // what it was, what it became and on which turn, until you or a later
  // quoted change settles it
  unconfirmed?: Unconfirmed;
};

export type Unconfirmed = { from: string; to: string; turn: number };

export type Store = {
  conv: string;
  title: string;
  items: Map<string, Item>;
  next: number;
  // each filed turn's topic
  topicOf: Map<number, string>;
  read: number; // the last turn filed
};

export const emptyStore = (conv: string, title: string): Store => ({
  conv,
  title,
  items: new Map(),
  next: 1,
  topicOf: new Map(),
  read: 0,
});

export const live = (s: Store) =>
  [...s.items.values()].filter((i) => !i.retired);

export const childrenOf = (s: Store, id: string | null) =>
  live(s).filter((i) => i.parent === id);

// What waits on you: an ask still waiting, an open question that is yours
// to answer, or a step only you can do (a task of yours: merge, deploy, test
// on your device) until it is done. Questions Claude will look into are open,
// not waiting. A step of yours stays waiting however long ago it came up: in
// the eval, ageing them out lost more real waits than it cleared stale ones.
export const isWaiting = (i: Item, _read?: number) =>
  !i.retired &&
  ((i.type === "ask" && i.state === "waiting") ||
    (i.type === "question" && i.state === "open" && i.owner === "you") ||
    (i.type === "task" &&
      i.owner === "you" &&
      (i.state === "to-do" || i.state === "doing")));

export const isOpen = (i: Item) =>
  !i.retired &&
  ((i.type === "question" && i.state === "open") ||
    (i.type === "task" && (i.state === "to-do" || i.state === "doing")) ||
    (i.type === "ask" && i.state === "waiting") ||
    (i.type === "decision" && i.state === "reopened") ||
    (i.type === "assumption" && i.state === "assumed"));

function inTopic(s: Store, topic: string): Item[] {
  const out: Item[] = [];
  const walk = (id: string) => {
    for (const c of childrenOf(s, id)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(topic);
  return out;
}

// waiting if anything in it waits on you; active if it holds a task in
// progress or is the newest topic; done when nothing in it is open
export function topicState(s: Store, topic: string): string {
  const items = inTopic(s, topic);
  if (items.some((i) => isWaiting(i, s.read))) return "waiting";
  const topics = live(s).filter((i) => i.type === "topic");
  if (
    items.some((i) => i.type === "task" && i.state === "doing") ||
    topics.at(-1)?.id === topic
  )
    return "active";
  return items.some(isOpen) ? "open" : "done";
}

// the map as mermaid+ sees it: topics get their derived state
export function toMapItems(s: Store): MapItem[] {
  return live(s).map((i) => ({
    id: i.id,
    type: i.type,
    state: i.type === "topic" ? topicState(s, i.id) : i.state,
    label: i.title,
    parent: i.parent,
    owner: i.owner,
    src: i.src.map((n) => `t${n}`),
    links: i.links.length ? i.links : undefined,
  }));
}

// The lists a person checks the map against (and the labeler writes): the
// gate in phase 2 is measured on these.
export type Lists = {
  waiting: Item[];
  open: Item[];
  decided: Item[];
  taken: Item[]; // options taken
};

export const listsOf = (s: Store): Lists => {
  const all = live(s);
  return {
    waiting: all.filter((i) => isWaiting(i, s.read)),
    open: all.filter(isOpen),
    decided: all.filter((i) => i.type === "decision" && i.state === "decided"),
    taken: all.filter((i) => i.type === "option" && i.state === "taken"),
  };
};
