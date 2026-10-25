// The item store on disk: one SQLite file per machine (~/.living-map/
// ledger.db, WAL), migrated by PRAGMA user_version. A run's raw answer is
// saved before it is applied, and one transaction applies it: its items,
// its log lines, the read point and the run's status move together, so a
// crash between the two applies the answer once on restart, never twice.
//
// The transcript's parse is not kept here: it is read again from the start
// on every server start (the reader takes under a second for the largest
// chats), so only the read point and what was filed are stored.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { emptyStore, type Item, type Store, type Writer } from "./items.ts";
import type { ChangeStatement } from "../shared/ledger.ts";

// one of your chats as the store keeps it, under the first id it had
export type Conv = {
  root: string;
  ids: string[]; // every id it went by, the root first
  title: string;
  cwd: string;
  file: string; // the transcript followed now
  lookedTurn: number; // the last turn when you last looked
  following: boolean;
  linkedAt: number;
  skipped: number; // older turns left unread when it was linked late
};

// what the map keeps of an item beside the item itself
export type Meta = {
  order: string; // its fractional order key among its siblings
  under: string | null; // the parent that key is under
  folded: boolean;
  filedAt: number;
};

export type State = {
  conv: Conv;
  store: Store;
  meta: Map<string, Meta>;
};

export type RunUsage = {
  usd: number;
  input: number;
  output: number;
  model: string;
};

export type Run = {
  id: number;
  conv: string;
  turns: number[];
  base: number; // the read point it was asked from
  answer: unknown;
  status: "answered" | "applied" | "failed";
  error: string;
};

export type LogLine = { writer: Writer; op: unknown };

const MIGRATIONS: string[] = [
  `CREATE TABLE conversations (
     root TEXT PRIMARY KEY,
     ids TEXT NOT NULL DEFAULT '[]',
     title TEXT NOT NULL DEFAULT '',
     cwd TEXT NOT NULL DEFAULT '',
     file TEXT NOT NULL DEFAULT '',
     looked_turn INTEGER NOT NULL DEFAULT 0,
     following INTEGER NOT NULL DEFAULT 0,
     linked_at INTEGER NOT NULL DEFAULT 0,
     skipped INTEGER NOT NULL DEFAULT 0,
     next_item INTEGER NOT NULL DEFAULT 1,
     read_turn INTEGER NOT NULL DEFAULT 0,
     topic_of TEXT NOT NULL DEFAULT '{}'
   );
   CREATE TABLE sources (
     path TEXT PRIMARY KEY,
     conv TEXT NOT NULL,
     offset INTEGER NOT NULL DEFAULT 0,
     read_at INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE items (
     conv TEXT NOT NULL,
     id TEXT NOT NULL,
     type TEXT NOT NULL,
     state TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     quote TEXT NOT NULL,
     src TEXT NOT NULL,
     parent TEXT,
     owner TEXT,
     basis TEXT NOT NULL,
     links TEXT NOT NULL,
     writers TEXT NOT NULL,
     retired TEXT,
     order_key TEXT NOT NULL,
     under TEXT,
     folded INTEGER NOT NULL DEFAULT 0,
     filed_at INTEGER NOT NULL,
     PRIMARY KEY (conv, id)
   );
   CREATE TABLE log (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     conv TEXT NOT NULL,
     run INTEGER,
     writer TEXT NOT NULL,
     op TEXT NOT NULL,
     at INTEGER NOT NULL
   );
   CREATE INDEX log_conv ON log (conv, seq);
   CREATE TABLE runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conv TEXT NOT NULL,
     turns TEXT NOT NULL,
     base INTEGER NOT NULL,
     answer TEXT,
     rejected TEXT,
     status TEXT NOT NULL,
     usd REAL NOT NULL DEFAULT 0,
     input INTEGER NOT NULL DEFAULT 0,
     output INTEGER NOT NULL DEFAULT 0,
     model TEXT NOT NULL DEFAULT '',
     ms INTEGER NOT NULL DEFAULT 0,
     error TEXT NOT NULL DEFAULT '',
     at INTEGER NOT NULL
   );
   CREATE INDEX runs_conv ON runs (conv, id);
   CREATE TABLE spend (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conv TEXT NOT NULL,
     run INTEGER,
     what TEXT NOT NULL,
     model TEXT NOT NULL DEFAULT '',
     input INTEGER NOT NULL DEFAULT 0,
     output INTEGER NOT NULL DEFAULT 0,
     usd REAL NOT NULL DEFAULT 0,
     at INTEGER NOT NULL
   );
   CREATE TABLE changes (
     conv TEXT NOT NULL,
     id TEXT NOT NULL,
     turn INTEGER NOT NULL,
     statement TEXT NOT NULL,
     review TEXT,
     PRIMARY KEY (conv, id)
   );`,
];

type Row = Record<string, SQLInputValue>;
const json = (v: unknown) => JSON.stringify(v);
const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const text = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export type LedgerDb = ReturnType<typeof openDb>;

// Opens (and creates, or migrates) the store. Yours alone: the folder is
// 0700 and the file 0600, since items quote your chats word for word.
export function openDb(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // SQLite gives its -wal and -shm files the main file's permissions
  fs.closeSync(fs.openSync(file, "a", 0o600));
  fs.chmodSync(file, 0o600);
  const db = new DatabaseSync(file, { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  const version = num(
    (db.prepare("PRAGMA user_version").get() as Row).user_version,
  );
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // runs `fn` in one transaction: all of it lands, or none
  function tx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  const convOf = (r: Row): Conv => ({
    root: text(r.root),
    ids: parse<string[]>(r.ids, []),
    title: text(r.title),
    cwd: text(r.cwd),
    file: text(r.file),
    lookedTurn: num(r.looked_turn),
    following: num(r.following) === 1,
    linkedAt: num(r.linked_at),
    skipped: num(r.skipped),
  });

  const putConv = db.prepare(
    `INSERT INTO conversations (root, ids, title, cwd, file, looked_turn, following, linked_at, skipped)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (root) DO UPDATE SET ids = excluded.ids, title = excluded.title,
       cwd = excluded.cwd, file = excluded.file, looked_turn = excluded.looked_turn,
       following = excluded.following, linked_at = excluded.linked_at,
       skipped = excluded.skipped`,
  );
  const saveConv = (c: Conv) =>
    putConv.run(
      c.root,
      json(c.ids),
      c.title,
      c.cwd,
      c.file,
      c.lookedTurn,
      c.following ? 1 : 0,
      c.linkedAt,
      c.skipped,
    );

  const putItem = db.prepare(
    `INSERT INTO items (conv, id, type, state, title, body, quote, src, parent, owner, basis, links, writers, retired, order_key, under, folded, filed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (conv, id) DO UPDATE SET type = excluded.type, state = excluded.state,
       title = excluded.title, body = excluded.body, quote = excluded.quote, src = excluded.src,
       parent = excluded.parent, owner = excluded.owner, basis = excluded.basis,
       links = excluded.links, writers = excluded.writers, retired = excluded.retired,
       order_key = excluded.order_key, under = excluded.under, folded = excluded.folded`,
  );
  const putLog = db.prepare(
    "INSERT INTO log (conv, run, writer, op, at) VALUES (?, ?, ?, ?, ?)",
  );
  const putPoint = db.prepare(
    "UPDATE conversations SET next_item = ?, read_turn = ?, topic_of = ? WHERE root = ?",
  );
  const markApplied = db.prepare(
    "UPDATE runs SET status = 'applied', rejected = ? WHERE id = ? AND conv = ? AND status = 'answered'",
  );
  const putRun = db.prepare(
    `INSERT INTO runs (conv, turns, base, answer, status, usd, input, output, model, ms, error, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const putSpend = db.prepare(
    "INSERT INTO spend (conv, run, what, model, input, output, usd, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );

  return {
    db,
    close: () => db.close(),

    conversations(): Conv[] {
      return (
        db
          .prepare("SELECT * FROM conversations ORDER BY linked_at DESC")
          .all() as Row[]
      ).map(convOf);
    },

    // the conversation any of these ids belongs to
    findConv(ids: string[]): Conv | null {
      const all = this.conversations();
      for (const id of ids) {
        const hit = all.find((c) => c.root === id || c.ids.includes(id));
        if (hit) return hit;
      }
      return null;
    },

    saveConv,

    // a conversation's store, as the last applied run left it
    load(root: string): State | null {
      const r = db
        .prepare("SELECT * FROM conversations WHERE root = ?")
        .get(root) as Row | undefined;
      if (!r) return null;
      const conv = convOf(r);
      const store = emptyStore(root, conv.title);
      store.next = num(r.next_item) || 1;
      store.read = num(r.read_turn);
      store.topicOf = new Map(
        Object.entries(parse<Record<string, string>>(r.topic_of, {})).map(
          ([k, v]) => [Number(k), v],
        ),
      );
      const meta = new Map<string, Meta>();
      const rows = db
        .prepare("SELECT * FROM items WHERE conv = ? ORDER BY filed_at, id")
        .all(root) as Row[];
      for (const i of rows) {
        const item: Item = {
          id: text(i.id),
          type: text(i.type) as Item["type"],
          state: text(i.state),
          title: text(i.title),
          body: text(i.body),
          quote: text(i.quote),
          src: parse<number[]>(i.src, []),
          parent: typeof i.parent === "string" ? i.parent : null,
          basis: text(i.basis) as Item["basis"],
          links: parse<Item["links"]>(i.links, []),
          writers: parse<Item["writers"]>(i.writers, {}),
        };
        if (i.owner === "you" || i.owner === "claude") item.owner = i.owner;
        if (typeof i.retired === "string") item.retired = i.retired;
        store.items.set(item.id, item);
        meta.set(item.id, {
          order: text(i.order_key),
          under: typeof i.under === "string" ? i.under : null,
          folded: num(i.folded) === 1,
          filedAt: num(i.filed_at),
        });
      }
      return { conv, store, meta };
    },

    // Writes a state and its log lines in one transaction. With `run`, it
    // is also that run's apply: refused (nothing written) unless the run
    // is still waiting to be applied, so an answer can't land twice.
    commit(
      s: State,
      lines: LogLine[],
      at: number,
      run?: { id: number; rejected: unknown[] },
    ) {
      tx(() => {
        if (run) {
          const r = markApplied.run(json(run.rejected), run.id, s.conv.root);
          if (Number(r.changes) !== 1)
            throw new Error(`run ${run.id} is not waiting to be applied`);
        }
        saveConv(s.conv);
        for (const i of s.store.items.values()) {
          const m = s.meta.get(i.id);
          if (!m) throw new Error(`item ${i.id} has no place`);
          putItem.run(
            s.conv.root,
            i.id,
            i.type,
            i.state,
            i.title,
            i.body,
            i.quote,
            json(i.src),
            i.parent,
            i.owner ?? null,
            i.basis,
            json(i.links),
            json(i.writers),
            i.retired ?? null,
            m.order,
            m.under,
            m.folded ? 1 : 0,
            m.filedAt,
          );
        }
        putPoint.run(
          s.store.next,
          s.store.read,
          json(Object.fromEntries(s.store.topicOf)),
          s.conv.root,
        );
        for (const l of lines)
          putLog.run(s.conv.root, run?.id ?? null, l.writer, json(l.op), at);
      });
    },

    // An extraction's answer, saved before anything is applied from it;
    // or, with `error`, a call that failed.
    saveRun(
      conv: string,
      r: {
        turns: number[];
        base: number;
        answer?: unknown;
        error?: string;
        usage: RunUsage | null;
        ms: number;
      },
      at: number,
    ): number {
      return tx(() => {
        const u = r.usage ?? { usd: 0, input: 0, output: 0, model: "" };
        const id = Number(
          putRun.run(
            conv,
            json(r.turns),
            r.base,
            r.error ? null : json(r.answer ?? null),
            r.error ? "failed" : "answered",
            u.usd,
            u.input,
            u.output,
            u.model,
            Math.round(r.ms),
            r.error ?? "",
            at,
          ).lastInsertRowid,
        );
        putSpend.run(
          conv,
          id,
          "extract",
          u.model,
          u.input,
          u.output,
          u.usd,
          at,
        );
        return id;
      });
    },

    // a saved answer that could not be applied (its turns are gone)
    failRun(id: number, error: string) {
      db.prepare(
        "UPDATE runs SET status = 'failed', error = ? WHERE id = ? AND status = 'answered'",
      ).run(error, id);
    },

    // answers saved but never applied: the server stopped in between
    pendingRuns(conv: string): Run[] {
      return (
        db
          .prepare(
            "SELECT * FROM runs WHERE conv = ? AND status = 'answered' ORDER BY id",
          )
          .all(conv) as Row[]
      ).map((r) => ({
        id: num(r.id),
        conv: text(r.conv),
        turns: parse<number[]>(r.turns, []),
        base: num(r.base),
        answer: parse<unknown>(r.answer, null),
        status: "answered",
        error: text(r.error),
      }));
    },

    // calls and dollars of the map's own work on a chat: all of it, and
    // since `since` (the start of today)
    spend(conv: string, since: number) {
      const all = db
        .prepare(
          "SELECT COUNT(*) AS n, TOTAL(usd) AS usd FROM runs WHERE conv = ?",
        )
        .get(conv) as Row;
      const today = db
        .prepare(
          "SELECT TOTAL(usd) AS usd FROM runs WHERE conv = ? AND at >= ?",
        )
        .get(conv, since) as Row;
      return { calls: num(all.n), usd: num(all.usd), todayUsd: num(today.usd) };
    },

    setSource(file: string, conv: string, offset: number, at: number) {
      db.prepare(
        `INSERT INTO sources (path, conv, offset, read_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET conv = excluded.conv, offset = excluded.offset, read_at = excluded.read_at`,
      ).run(file, conv, offset, at);
    },

    log(conv: string): { seq: number; writer: string; op: unknown }[] {
      return (
        db
          .prepare(
            "SELECT seq, writer, op FROM log WHERE conv = ? ORDER BY seq",
          )
          .all(conv) as Row[]
      ).map((r) => ({
        seq: num(r.seq),
        writer: text(r.writer),
        op: parse<unknown>(r.op, null),
      }));
    },

    // what changed in the system, filed per turn by the follower's snapshots
    addChanges(conv: string, list: ChangeStatement[]) {
      const put = db.prepare(
        "INSERT OR IGNORE INTO changes (conv, id, turn, statement) VALUES (?, ?, ?, ?)",
      );
      for (const c of list) put.run(conv, c.id, c.turn, JSON.stringify(c));
    },

    changes(conv: string): ChangeStatement[] {
      return (
        db
          .prepare(
            "SELECT statement, review FROM changes WHERE conv = ? ORDER BY turn, id",
          )
          .all(conv) as Row[]
      ).flatMap((r) => {
        const c = parse<ChangeStatement | null>(r.statement, null);
        if (!c) return [];
        const review = text(r.review);
        return [
          review ? { ...c, review: review as ChangeStatement["review"] } : c,
        ];
      });
    },

    // a change statement's review, by you
    review(conv: string, id: string, review: string | null): boolean {
      const r = db
        .prepare("UPDATE changes SET review = ? WHERE conv = ? AND id = ?")
        .run(review, conv, id);
      return Number(r.changes) === 1;
    },
  };
}
