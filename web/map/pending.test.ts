// The placeholder for turns on their way to the map: which turns, what it
// says, where it hangs, and when there is none.

import assert from "node:assert/strict";
import { test } from "vitest";

import { PENDING, pendingItem, pendingTurns } from "./pending.ts";
import type { LedgerItem, LedgerView } from "../../shared/ledger.ts";

const topic = (id: string): LedgerItem => ({
  id,
  type: "topic",
  state: "active",
  title: `topic ${id}`,
  body: "",
  quote: "",
  src: [1],
  parent: null,
  basis: "said",
  links: [],
  waiting: false,
  open: false,
  isNew: false,
  order: "a0001",
});

const view = (health: LedgerView["health"], now: string | null = "i1") =>
  ({
    read: 10,
    turns: 12,
    now,
    items: [topic("i1")],
    health,
  }) as LedgerView;

test("a run under way names its turns; otherwise what is behind, from the read point", () => {
  assert.deepEqual(
    pendingTurns(view({ following: true, behind: 2 })),
    [11, 12],
  );
  assert.deepEqual(
    pendingTurns(
      view({ following: true, behind: 3, filing: { turns: [11], since: 0 } }),
    ),
    [11],
  );
  assert.deepEqual(pendingTurns(view({ following: true, behind: 0 })), []);
});

test("the box hangs under the topic the chat is on, sorts last, and is drawn only", () => {
  const p = pendingItem(view({ following: true, behind: 1 }))!;
  assert.equal(p.id, PENDING);
  assert.equal(p.title, "Filing turn 11…");
  assert.equal(p.parent, "i1");
  assert.ok(p.order > "zzzz", "after every real key");
  assert.equal(p.waiting, false);
  assert.equal(p.open, false);
  assert.equal(
    pendingItem(view({ following: true, behind: 2 }))!.title,
    "Filing turns 11–12…",
  );
  // the topic named is gone from the map: from the root
  assert.equal(
    pendingItem(view({ following: true, behind: 1 }, "i9"))!.parent,
    null,
  );
  assert.equal(
    pendingItem(view({ following: true, behind: 1 }, null))!.parent,
    null,
  );
});

test("no box when nothing is on its way, or the map isn't following", () => {
  assert.equal(pendingItem(view({ following: true, behind: 0 })), null);
  assert.equal(pendingItem(view({ following: false, behind: 3 })), null);
});
