// Following a chat live, on synthetic transcripts in a temp folder, a
// scripted model and a clock the test moves: when turns seal and when a run
// starts, one run per chat and two overall, backoff after a failure, a long
// chat linked late, a crash between saving an answer and applying it, and
// what you do on the map.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { applyAction } from "./apply.ts";
import { openDb, type Conv } from "./db.ts";
import { SWEEP_SYSTEM } from "./extract.ts";
import { backoff, createLedger, QUIET_MS } from "./follow.ts";
import { emptyStore, type Item } from "./items.ts";
import type {
  ExtractRequest,
  ExtractResult,
} from "../server/providers/types.ts";
import type { LedgerEvent } from "../shared/ledger.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-follow-"));
let fileN = 0;

// ---- a transcript in the shapes Claude Code writes --------------------------

function chat() {
  const file = path.join(tmp, `chat-${++fileN}.jsonl`);
  fs.writeFileSync(file, "");
  let last: string | null = null;
  let n = 0;
  const write = (d: object) =>
    fs.appendFileSync(file, `${JSON.stringify(d)}\n`);
  const base = (type: string) => {
    const uuid = `u${fileN}-${++n}`;
    const d = {
      parentUuid: last,
      isSidechain: false,
      type,
      uuid,
      timestamp: new Date(1_700_000_000_000 + n * 1000).toISOString(),
      sessionId: `s${fileN}`,
    };
    last = uuid;
    return d;
  };
  return {
    file,
    id: `s${fileN}`,
    you(text: string) {
      write({
        ...base("user"),
        message: { role: "user", content: text },
        origin: { kind: "human" },
        promptSource: "sdk",
      });
    },
    claude(text: string, stop = "end_turn") {
      write({
        ...base("assistant"),
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          stop_reason: stop,
        },
      });
    },
    turn(you: string, claude: string) {
      this.you(you);
      this.claude(claude);
    },
  };
}

// ---- a scripted model: a topic per batch, a question per "?" turn ----------

type Script = (req: ExtractRequest) => ExtractResult | Promise<ExtractResult>;

const turnsOf = (msg: string) =>
  [...msg.matchAll(/TURN (\d+) · YOU:\n(.*)/g)].map((m) => ({
    n: Number(m[1]),
    text: m[2]!,
  }));

const filing = (req: ExtractRequest): ExtractResult => {
  const turns = turnsOf(req.message);
  const first = turns[0]!;
  const ops: unknown[] = [
    {
      op: "create",
      ref: "new1",
      type: "topic",
      title: `About ${first.text}`,
      quote: first.text,
      turn: first.n,
    },
  ];
  for (const t of turns)
    if (t.text.includes("?"))
      ops.push({
        op: "create",
        type: "question",
        title: t.text,
        quote: t.text,
        turn: t.n,
        parent: "new1",
        owner: "you",
      });
  return {
    ok: true,
    value: { topics: turns.map((t) => ({ turn: t.n, topic: "new1" })), ops },
    ms: 5,
    usage: {
      input: 100,
      output: 20,
      costUsd: 0.01,
      model: "scripted",
      effort: "low",
    },
  };
};

function setup(
  script: Script = filing,
  dbFile?: string,
  changes?: Parameters<typeof createLedger>[0]["changes"],
) {
  let clock = Date.now();
  const calls: ExtractRequest[] = [];
  const events: LedgerEvent[] = [];
  const told: { conv: Conv; text: string }[] = [];
  const file = dbFile ?? path.join(tmp, `ledger-${++fileN}.db`);
  const db = openDb(file);
  const ledger = createLedger({
    db,
    extract: async (req) => {
      calls.push(req);
      return script(req);
    },
    emit: (e) => events.push(e),
    tell: (conv, text) => told.push({ conv, text }),
    now: () => clock,
    everyMs: 0,
    findSuccessor: () => null,
    changes,
  });
  return {
    db,
    file,
    ledger,
    calls,
    events,
    told,
    advance: (ms: number) => (clock += ms),
    link: (c: { id: string; file: string }) =>
      ledger.follow({ id: c.id, file: c.file, cwd: tmp, title: "A chat" }),
  };
}

// ---- sealing and triggers ---------------------------------------------------

test("a turn seals after 5 s still, and one that asks runs at once", async () => {
  const c = chat();
  const t = setup();
  const root = t.link(c);
  c.turn("Which database should we use?", "Postgres or Mongo, which one?");
  await t.ledger.tick();
  // Claude ended it, but the file was written just now: not sealed yet
  assert.equal(t.calls.length, 0);
  assert.equal(t.ledger.view(root)!.turns, 1);
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1, "asks something: filed at once");
  const v = t.ledger.view(root)!;
  assert.equal(v.read, 1);
  assert.equal(v.health.behind, 0);
  assert.deepEqual(
    v.items.map((i) => [i.type, i.title]),
    [
      ["topic", "About Which database should we use?"],
      ["question", "Which database should we use?"],
    ],
  );
  assert.deepEqual(v.strip.waiting, [v.items[1]!.id]);
  assert.ok(v.items.every((i) => i.isNew));
  assert.ok(t.events.some((e) => e.type === "ledger" && e.view.read === 1));
});

test("a later prompt seals a turn; three sealed turns run, fewer wait for 20 s of quiet", async () => {
  const c = chat();
  const t = setup();
  const root = t.link(c);
  c.turn("Rename the module", "Done.");
  c.turn("Now the tests", "Updated.");
  c.you("And the docs");
  await t.ledger.tick();
  // two sealed by the prompts after them, nothing asked: they wait
  assert.equal(t.calls.length, 0);
  assert.equal(t.ledger.view(root)!.health.behind, 2);
  c.claude("Docs too.");
  c.turn("Last, the changelog", "Written.");
  t.advance(1000);
  await t.ledger.tick();
  // turn 3 sealed by turn 4's prompt: three wait, so they run
  assert.equal(t.calls.length, 1);
  assert.deepEqual(
    turnsOf(t.calls[0]!.message).map((x) => x.n),
    [1, 2, 3],
  );
  // turn 4 seals once still for 5 s, then waits for 20 s of quiet
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1);
  t.advance(QUIET_MS);
  await t.ledger.tick();
  assert.equal(t.calls.length, 2);
  assert.equal(t.ledger.view(root)!.read, 4);
});

test("a failure is tried again later and later, its error shown until one works", async () => {
  const c = chat();
  let fail = 2;
  const t = setup((req) =>
    fail-- > 0
      ? { ok: false, error: "rate limited", ms: 1, usage: null }
      : filing(req),
  );
  const root = t.link(c);
  c.turn("Should we ship it?", "Ready when you are. Ship it?");
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1);
  assert.equal(t.ledger.view(root)!.health.error, "rate limited");
  t.advance(backoff(1) - 1000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1, "waits 30 s");
  t.advance(1000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 2);
  t.advance(backoff(1));
  await t.ledger.tick();
  assert.equal(t.calls.length, 2, "then a minute");
  t.advance(backoff(2) - backoff(1));
  await t.ledger.tick();
  assert.equal(t.calls.length, 3);
  const v = t.ledger.view(root)!;
  assert.equal(v.health.error, undefined);
  assert.equal(v.read, 1);
  assert.equal(v.spend.calls, 3);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map(backoff),
    [30_000, 60_000, 120_000, 240_000, 480_000, 600_000],
  );
});

// Waits for what a tick starts (file reads, then the call) without guessing
// how long that takes on a busy machine; settle() leaves room for anything
// that should NOT start to show up.
async function until(cond: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end)
    await new Promise((r) => setTimeout(r, 10));
}
const settle = () => new Promise((r) => setTimeout(r, 100));

test("one run per chat at a time, two at most overall", async () => {
  const chats = [chat(), chat(), chat()];
  // which two chats run first depends on which reads finish first, so the
  // test checks the rules, not an order: never two runs for one chat, never
  // more than two at once, and every turn filed in the end
  let running = 0;
  let most = 0;
  const release: (() => void)[] = [];
  const t = setup((req) => {
    running++;
    most = Math.max(most, running);
    return new Promise((done) =>
      release.push(() => {
        running--;
        done(filing(req));
      }),
    );
  });
  const roots = chats.map((c) => {
    const root = t.link(c);
    c.turn("Pick one?", "A or B?");
    // written long ago: sealed on first read, whatever the machine's load
    const ago = (Date.now() - 3_600_000) / 1000;
    fs.utimesSync(c.file, ago, ago);
    return root;
  });
  const round = t.ledger.tick();
  await until(() => t.calls.length >= 2);
  await settle();
  assert.equal(t.calls.length, 2, "the third chat waits");
  // a chat's next turn arrives while runs are out
  chats[0]!.turn("And then?", "C?");
  t.advance(60_000);
  void t.ledger.tick();
  await settle();
  assert.equal(t.calls.length, 2, "nothing more starts while two run");
  for (const r of release.splice(0)) r();
  await round;
  // drain: whatever waits runs, two at a time, until every turn is filed
  for (let k = 0; k < 6; k++) {
    t.advance(60_000);
    const next = t.ledger.tick();
    await settle();
    for (const r of release.splice(0)) r();
    await next;
    if (roots.every((r, n) => t.ledger.view(r)!.read === (n === 0 ? 2 : 1)))
      break;
  }
  assert.ok(most <= 2, `at most two at once, saw ${most}`);
  assert.deepEqual(
    roots.map((r) => t.ledger.view(r)!.read),
    [2, 1, 1],
  );
}, 30_000);

test("a long chat linked late reads its newest 40 turns first", async () => {
  const c = chat();
  for (let i = 1; i <= 50; i++) c.turn(`Step ${i}`, `Did step ${i}.`);
  // written an hour ago: every turn is sealed when it is first read
  const ago = (Date.now() - 3_600_000) / 1000;
  fs.utimesSync(c.file, ago, ago);
  const t = setup();
  const root = t.link(c);
  await t.ledger.tick();
  // the first batch reads turns 11-13; the rest show as reading
  assert.deepEqual(
    turnsOf(t.calls[0]!.message).map((x) => x.n),
    [11, 12, 13],
  );
  const v = t.ledger.view(root)!;
  assert.deepEqual(v.health.reading, { done: 3, total: 40 });
  for (let i = 0; i < 20; i++) await t.ledger.tick();
  const done = t.ledger.view(root)!;
  assert.equal(done.read, 50);
  assert.equal(done.health.reading, undefined);
  assert.equal(t.calls.length, 14);
  assert.equal(t.db.findConv([root])!.skipped, 10);
});

test("the map's model is the setting's, never Haiku", async () => {
  for (const [asked, used] of [
    ["", ""],
    ["sonnet", "sonnet"],
    ["claude-haiku-5-5", ""],
  ]) {
    const c = chat();
    let clock = Date.now();
    const models: (string | undefined)[] = [];
    const ledger = createLedger({
      db: openDb(path.join(tmp, `m-${++fileN}.db`)),
      extract: async (req) => {
        models.push(req.model);
        return filing(req);
      },
      emit: () => {},
      model: () => asked!,
      now: () => clock,
      everyMs: 0,
    });
    ledger.follow({ id: c.id, file: c.file, cwd: tmp, title: "x" });
    c.turn("Go?", "Go?");
    clock += 6000;
    await ledger.tick();
    assert.deepEqual(models, [used]);
  }
});

// ---- crash safety -----------------------------------------------------------

test("an answer saved but never applied is applied once on restart, never twice", async () => {
  const c = chat();
  c.turn("Which cache should we use?", "Redis or memcached?");
  // the first server saves the answer and stops before applying it
  const first = setup();
  const root = first.link(c);
  const answer = filing({
    system: "",
    schema: {},
    message: "TURN 1 · YOU:\nWhich cache should we use?",
  });
  first.db.saveRun(
    root,
    {
      turns: [1],
      base: 0,
      answer: answer.value,
      usage: { usd: 0.01, input: 1, output: 1, model: "x" },
      ms: 1,
    },
    1,
  );
  first.ledger.close();
  first.db.close();

  // restarted: the follower picks the chat up and applies the saved answer
  const second = setup(filing, first.file);
  second.ledger.resume();
  assert.deepEqual(second.ledger.following(), [root]);
  await second.ledger.tick();
  const v = second.ledger.view(root)!;
  assert.equal(v.read, 1);
  assert.equal(v.items.length, 2);
  assert.equal(second.calls.length, 0, "no new call: the answer was saved");
  second.ledger.close();
  second.db.close();

  // and restarted again: nothing applies twice
  const third = setup(filing, first.file);
  third.ledger.resume();
  third.advance(60_000);
  await third.ledger.tick();
  const again = third.ledger.view(root)!;
  assert.equal(again.items.length, 2);
  assert.equal(third.calls.length, 0);
  assert.equal(
    third.db.log(root).filter((l) => l.writer === "extractor").length,
    2,
  );
  assert.throws(
    () => third.db.commit(third.db.load(root)!, [], 1, { id: 1, rejected: [] }),
    /not waiting/,
  );
});

// ---- what you do on the map -------------------------------------------------

test("your actions land as yours, and an answer reaches the chat", async () => {
  const c = chat();
  const t = setup();
  const root = t.link(c);
  c.turn("Should we use Postgres?", "Postgres? Yes or no?");
  c.turn("Can it run on my laptop?", "Docker or native?");
  t.advance(6000);
  // each turn asks something: one run each
  await t.ledger.tick();
  await t.ledger.tick();
  const v = t.ledger.view(root)!;
  const [q1, q2] = v.items.filter((i) => i.type === "question");
  assert.ok(q1 && q2);
  const [t1, t2] = v.items.filter((i) => i.type === "topic");
  assert.ok(t1!.order < t2!.order, "a later topic sorts after");
  assert.equal(q1.order, q2.order, "each the first under its own topic");

  let r = t.ledger.act(root, { type: "answer", item: q1.id, text: "Yes" });
  assert.equal(r.error, undefined);
  assert.equal(t.told.length, 1);
  assert.match(t.told[0]!.text, /answered "Should we use Postgres\?": Yes/);
  assert.equal(r.view!.items.find((i) => i.id === q1.id)!.state, "answered");

  r = t.ledger.act(root, { type: "not-right", item: q2.id });
  assert.ok(!r.view!.items.some((i) => i.id === q2.id));
  r = t.ledger.act(root, { type: "fold", item: v.items[0]!.id, folded: true });
  assert.equal(r.view!.items[0]!.folded, true);
  r = t.ledger.act(root, { type: "state", item: q1.id, state: "nonsense" });
  assert.match(r.error!, /can't be/);
  r = t.ledger.act(root, { type: "looked" });
  assert.equal(r.view!.lookedTurn, 2);
  assert.ok(r.view!.items.every((i) => !i.isNew));

  const log = t.db.log(root).filter((l) => l.writer === "you");
  assert.deepEqual(
    log.map((l) => (l.op as { op: string }).op),
    ["answer", "miss", "fold", "looked"],
  );
  // the extractor can't undo your answer: the field is yours
  const s = t.db.load(root)!;
  assert.equal(s.store.items.get(q1.id)!.writers.state, "you");
  assert.equal(s.meta.get(v.items[0]!.id)!.folded, true);
});

test("taking an option, reopening a decision and finishing your task tell the chat at once", () => {
  const store = emptyStore("c", "A chat");
  const add = (id: string, type: Item["type"], state: string, more = {}) =>
    store.items.set(id, {
      id,
      type,
      state,
      title: `The ${type}`,
      body: "",
      quote: "",
      src: [1],
      parent: null,
      basis: "said",
      links: [],
      writers: {},
      ...more,
    });
  add("i1", "question", "open");
  add("i2", "option", "offered", { parent: "i1" });
  add("i3", "decision", "decided");
  add("i4", "task", "to-do", { owner: "you" });
  add("i5", "task", "doing", { owner: "claude" });
  add("i6", "assumption", "assumed");
  const s = {
    conv: {} as Conv,
    store,
    meta: new Map(),
  };
  const tell = (item: string, state: string) =>
    applyAction(s, { type: "state", item, state }, 1).tell;
  assert.equal(
    tell("i2", "taken"),
    'On the map, the user took the option "The option" for "The question".',
  );
  assert.match(tell("i3", "reopened")!, /reopened the decision "The decision"/);
  assert.match(tell("i4", "done")!, /marked their task "The task" done/);
  assert.equal(tell("i5", "done"), undefined, "Claude's own task: no");
  assert.equal(tell("i6", "confirmed"), undefined);
});

// ---- what changed ------------------------------------------------------------

test("a snapshot when following starts and after each sealed turn; what differs is filed against the turn", async () => {
  const snaps: string[] = [];
  const compared: [string, string, number][] = [];
  const c = chat();
  const t = setup(filing, undefined, {
    shadowFor: () => ({ root: tmp, gitDir: tmp }),
    snapshot: (_sh, label) => {
      snaps.push(label);
      return `c${snaps.length}`;
    },
    compare: (_sh, a, b, turn) => {
      compared.push([a, b, turn]);
      return {
        changed: [{ file: "app/server/x.ts", status: "M", readable: true }],
        statements: [
          {
            op: "added",
            kind: "import-edge",
            key: "app/server→app/layer",
            text: "app/server imports app/layer",
            from: "app/server",
            to: "app/layer",
            files: ["app/server/x.ts"],
            evidence: [{ file: "app/server/x.ts", turn }],
          },
        ],
      };
    },
  });
  const root = t.link(c);
  await t.ledger.tick();
  assert.deepEqual(snaps, ["start"]);
  c.turn("Wire the layer in.", "Done: the server now imports the layer.");
  // read as it grows, sealed once the file has been still 5 s
  await t.ledger.tick();
  assert.deepEqual(snaps, ["start"]);
  t.advance(6000);
  await t.ledger.tick();
  assert.deepEqual(snaps, ["start", "after turn 1"]);
  assert.deepEqual(compared, [["c1", "c2", 1]]);
  const v = t.ledger.view(root)!;
  assert.equal(v.changes.length, 1);
  assert.deepEqual(
    { ...v.changes[0], id: "" },
    {
      id: "",
      change: "added",
      kind: "import-edge",
      text: "app/server imports app/layer",
      module: "app/server",
      file: "app/server/x.ts",
      turn: 1,
      low: false,
    },
  );
  assert.equal(v.strip.since.changes, 1);
  // the same turn read again files nothing twice
  await t.ledger.tick();
  assert.equal(t.ledger.view(root)!.changes.length, 1);
});

test("what waits on you and goes quiet is swept: checked again against the turns since", async () => {
  const c = chat();
  const sweeps: ExtractRequest[] = [];
  const t = setup((req) => {
    if (req.system !== SWEEP_SYSTEM) return filing(req);
    sweeps.push(req);
    const id = /- (i\d+) question/.exec(req.message)?.[1];
    const n = Number(/TURN (\d+) · YOU:\nI chose/.exec(req.message)?.[1] ?? 0);
    return {
      ok: true,
      value: {
        topics: [],
        ops: [
          {
            op: "update",
            item: id,
            state: "answered",
            turn: n,
            quote: "I chose",
          },
        ],
      },
      ms: 1,
      usage: null,
    };
  });
  const root = t.link(c);
  // the file is old: every turn is sealed when first read
  c.turn("Postgres or Mongo?", "Which do you want?");
  for (let k = 0; k < 11; k++)
    c.turn(k === 4 ? "I chose Postgres, go on." : "next", "Done.");
  const ago = (Date.now() - 3_600_000) / 1000;
  fs.utimesSync(c.file, ago, ago);
  for (let k = 0; k < 8 && t.ledger.view(root)!.read < 12; k++) {
    t.advance(60_000);
    await t.ledger.tick();
  }
  assert.ok(sweeps.length >= 1, "a sweep ran");
  const v = t.ledger.view(root)!;
  assert.deepEqual(v.strip.waiting, []);
}, 30_000);
