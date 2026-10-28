// The store on disk: a state written and read back is the same state, the
// file is yours alone, opening it again migrates nothing twice, and a run's
// apply lands whole or not at all.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";

import { applyAnswer, place } from "./apply.ts";
import { openDb, type State } from "./db.ts";
import { emptyStore } from "./items.ts";
import type { Turn } from "./transcript.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-db-"));

const turn = (n: number, text: string, reply = "Sure."): Turn => ({
  n,
  prompt: `p${n}`,
  via: "typed",
  text,
  ts: n,
  end: n,
  reply,
  entries: [],
  changes: [],
  hooks: [],
});

function fresh(root = "c1"): State {
  return {
    conv: {
      root,
      ids: [root, "c1-later"],
      title: "A chat",
      cwd: "/work",
      file: "/work/c1.jsonl",
      lookedTurn: 1,
      following: true,
      linkedAt: 5,
      skipped: 0,
    },
    store: emptyStore(root, "A chat"),
    meta: new Map(),
  };
}

test("a state written and read back is the same", () => {
  const file = path.join(tmp, "home", "ledger.db");
  const db = openDb(file);
  const s = fresh();
  db.saveConv(s.conv);
  const turns = [
    turn(1, "Should we use Postgres or Mongo?", "Postgres, or Mongo?"),
    turn(2, "Postgres. Now write the migration."),
  ];
  applyAnswer(
    s,
    {
      topics: [
        { turn: 1, topic: "new1" },
        { turn: 2, topic: "new1" },
      ],
      ops: [
        {
          op: "create",
          ref: "new1",
          type: "topic",
          title: "The database",
          quote: "Should we use Postgres",
          turn: 1,
        },
        {
          op: "create",
          ref: "new2",
          type: "question",
          title: "Postgres or Mongo?",
          quote: "Postgres or Mongo",
          turn: 1,
          parent: "new1",
          owner: "you",
        },
        {
          op: "update",
          item: "new2",
          state: "answered",
          quote: "Postgres.",
          turn: 2,
        },
        {
          op: "create",
          type: "task",
          title: "Write the migration",
          quote: "write the migration",
          turn: 2,
          owner: "claude",
        },
      ],
    },
    turns,
    100,
  );
  s.meta.get("i1")!.folded = true;
  s.store.items.get("i3")!.retired = "merged";
  s.store.items.get("i2")!.unconfirmed = {
    from: "open",
    to: "answered",
    turn: 2,
  };
  s.conv.readExtent = { reply: 120, asked: 2 };
  db.commit(s, [{ writer: "extractor", op: { op: "x" } }], 100);
  db.close();

  const again = openDb(file);
  const back = again.load("c1")!;
  assert.deepEqual(back.conv, s.conv);
  // as JSON: an owner left undefined is not stored
  const plain = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
  assert.deepEqual(
    plain([...back.store.items.values()]),
    plain([...s.store.items.values()]),
  );
  assert.deepEqual(back.meta, s.meta);
  assert.deepEqual(back.store.topicOf, s.store.topicOf);
  assert.equal(back.store.next, 4);
  assert.equal(back.store.read, 2);
  assert.equal(again.findConv(["c1-later"])?.root, "c1");
  assert.equal(again.findConv(["nobody"]), null);
  assert.equal(again.log("c1").length, 1);
  assert.equal(
    Number(
      (
        again.db.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version,
    ),
    4,
  );
  again.close();

  // yours alone: items quote your chats
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
});

test("a run applies whole or not at all, and only once", () => {
  const db = openDb(path.join(tmp, "runs.db"));
  const s = fresh("c2");
  db.saveConv(s.conv);
  const id = db.saveRun(
    "c2",
    {
      turns: [1],
      base: 0,
      answer: { topics: [], ops: [] },
      usage: { usd: 0.02, input: 10, output: 5, model: "m" },
      ms: 3,
    },
    1,
  );
  assert.equal(db.pendingRuns("c2").length, 1);

  // an item with no place makes the write fail: nothing of it lands
  s.store.items.set("i1", {
    id: "i1",
    type: "topic",
    state: "",
    title: "T",
    body: "",
    quote: "q",
    src: [1],
    parent: null,
    basis: "said",
    links: [],
    writers: {},
  });
  s.store.read = 1;
  assert.throws(() => db.commit(s, [], 2, { id, rejected: [] }));
  assert.equal(db.load("c2")!.store.items.size, 0);
  assert.equal(db.load("c2")!.store.read, 0);
  assert.equal(db.pendingRuns("c2").length, 1, "still waiting");

  place(s, 2);
  db.commit(s, [], 2, { id, rejected: [] });
  assert.equal(db.pendingRuns("c2").length, 0);
  assert.equal(db.load("c2")!.store.read, 1);
  assert.throws(() => db.commit(s, [], 3, { id, rejected: [] }), /not waiting/);
  assert.deepEqual(db.spend("c2", 0), { calls: 1, usd: 0.02, todayUsd: 0.02 });
  assert.deepEqual(db.spend("c2", 10), { calls: 1, usd: 0.02, todayUsd: 0 });
  db.close();
});

test("a store from before the unconfirmed column opens with its items whole", () => {
  const file = path.join(tmp, "old", "ledger.db");
  // the store as user_version 2 left it: every table, none of the later columns
  openDb(file).close();
  const raw = new DatabaseSync(file);
  raw.exec(
    `ALTER TABLE items DROP COLUMN unconfirmed;
     ALTER TABLE conversations DROP COLUMN read_extent;
     PRAGMA user_version = 2;
     INSERT INTO conversations (root, ids, title) VALUES ('old', '["old"]', 'Old');
     INSERT INTO items (conv, id, type, state, title, body, quote, src, parent, owner, basis, links, writers, order_key, filed_at)
     VALUES ('old', 'i1', 'question', 'answered', 'Which store?', '', 'Which store?', '[1]', NULL, 'you', 'said', '[]', '{}', 'a1', 1);`,
  );
  raw.close();
  const db = openDb(file);
  const back = db.load("old")!;
  assert.equal(back.store.items.get("i1")!.state, "answered");
  assert.equal(back.store.items.get("i1")!.unconfirmed, undefined);
  assert.equal(back.conv.readExtent, undefined);
  // the store as it was before migrating, kept beside it, yours alone
  const copy = `${file}.before-v4`;
  assert.equal(fs.statSync(copy).mode & 0o777, 0o600);
  const kept = new DatabaseSync(copy);
  assert.equal(
    Number(
      (kept.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ),
    2,
  );
  assert.equal(
    (
      kept.prepare("SELECT title FROM items WHERE id = 'i1'").get() as {
        title: string;
      }
    ).title,
    "Which store?",
  );
  kept.close();
  assert.equal(
    Number(
      (db.db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ),
    4,
  );
  db.close();
});

test("a new store, or one already migrated, makes no copy", () => {
  const file = path.join(tmp, "new", "ledger.db");
  openDb(file).close();
  openDb(file).close();
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).filter((f) => f.includes("before")),
    [],
  );
});
