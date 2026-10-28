// Following your chats live: one follower per linked chat reads its
// transcript as it grows, and files the new sealed turns with one fresh
// extractor call (extract.ts) that sees only the map so far and those
// turns, so it costs the same however long the chat gets.
//
// - Every second it reads what the transcript gained.
// - A turn is sealed when a later prompt exists, or the file has been still
//   for 2 s after Claude ended it (transcript.ts).
// - It runs as soon as a sealed turn waits: the map's delay is the seal and
//   the model call, nothing else. Turns that seal while a run is out go in
//   the next one, three at a time.
// - One extraction per chat at a time, at most 2 overall; a failure is
//   tried again later and later (30 s doubling to 10 min), its error shown.
// - A long chat linked late reads its newest 40 turns first; older ones are
//   skipped for now.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  applyAction,
  applyAnswer,
  checkAnswer,
  place,
  type Acted,
} from "./apply.ts";
import type { Compared, Shadow } from "./changes/snapshot.ts";
import type { Conv, Extent, LedgerDb, State } from "./db.ts";
import {
  batches,
  message,
  quiet,
  SCHEMA,
  SWEEP_EVERY,
  SWEEP_SYSTEM,
  sweepMessage,
  SYSTEM,
  type Answer,
} from "./extract.ts";
import { planOf, type Plan } from "./tasks.ts";
import {
  emptyTranscript,
  readMore,
  view as readView,
  type Transcript,
  type Turn,
} from "./transcript.ts";
import { buildView } from "./view.ts";
import { successor } from "../server/providers/claude-sessions.ts";
import type {
  Conversation,
  ExtractRequest,
  ExtractResult,
} from "../server/providers/types.ts";
import type {
  LedgerAction,
  LedgerEvent,
  LedgerView,
} from "../shared/ledger.ts";

export const TICK_MS = 1000;
export const BATCH = 3;
export const LATE_TURNS = 40;
export const MAX_RUNNING = 2;
// how long a quiet chat waits before looking for its continuation (resumed
// under a new id, in another file)
const SUCCESSOR_MS = 15_000;

// how much of a turn there is to read: its reply and its question-tool lines
export const extentOfTurn = (t: Turn): Extent => ({
  reply: t.reply.length,
  asked: t.asked?.length ?? 0,
});

// A turn the map has filed can still grow: a notice (a background task
// finishing, the map's own listener among them) is not a prompt, so what
// Claude does next is more of the same turn. Its new part, past `read`, as a
// turn of the same number the extractor can file; null when nothing was added.
export function continuationOf(t: Turn, read: Extent): Turn | null {
  const reply = t.reply.slice(read.reply).trim();
  const asked = (t.asked ?? []).slice(read.asked);
  if (!reply && !asked.length) return null;
  return {
    ...t,
    text: `(No new message from you. This is more of turn ${t.n}: Claude went on after a background task finished; what came before was filed already.)`,
    reply,
    asked,
  };
}

export const backoff = (failures: number) =>
  failures ? Math.min(10 * 60_000, 30_000 * 2 ** (failures - 1)) : 0;

export type LedgerDeps = {
  db: LedgerDb;
  extract?: (req: ExtractRequest) => Promise<ExtractResult>;
  emit: (e: LedgerEvent) => void;
  // words for the main chat, delivered through its inbox (`quiet`: they
  // wait for your next message there instead of waking it)
  tell?: (conv: Conv, text: string, quiet?: boolean) => void;
  // when the main chat last took what waited in its inbox (0: never)
  heardAt?: (conv: Conv) => number;
  // the model the extractor runs on ("" for Claude Code's default)
  model?: () => string;
  now?: () => number;
  everyMs?: number; // 0: no timer (tests call tick)
  findSuccessor?: (file: string, id: string) => string | null;
  // what changed in the system: snapshots at each newly sealed turn (absent
  // in tests that don't need it)
  changes?: {
    shadowFor: (cwd: string) => Shadow | null;
    snapshot: (sh: Shadow, label: string) => string | null;
    compare: (sh: Shadow, a: string, b: string, turn: number) => Compared;
  };
};

type Follower = {
  s: State;
  t: Transcript;
  file: string;
  grewAt: number; // when the transcript last grew
  turns: Turn[];
  sealed: number;
  readOnce: boolean;
  readBusy: boolean;
  running: Promise<void> | null;
  failures: number;
  retryAt: number;
  error?: string;
  // a backlog being read (linked late, or many turns behind): from where,
  // up to which turn
  backlog?: { from: number; to: number };
  nudged: boolean; // the page opened: run what is waiting now
  lookedForNext: number;
  // the shadow repository (null: the chat isn't in a git work tree;
  // undefined: not looked for yet), its last snapshot, and the sealed
  // turns it covers
  shadow?: Shadow | null;
  snap?: string;
  snapped: number;
  // Claude's own task list, as its calls left it
  plan?: Plan;
  lastSweep: number; // the read point the last sweep checked at
  // How long the map takes: when each turn was seen sealed (only turns
  // sealed while following; a chat's past has no times), the run under way,
  // and how the last run did. The page shows them; the log keeps one line
  // per run.
  sealedAt: Map<number, number>;
  filing?: LedgerView["health"]["filing"];
  lag?: LedgerView["health"]["lag"];
};

const mtimeOf = (file: string) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
};

const unique = (ids: string[]) => [...new Set(ids.filter(Boolean))];

export function createLedger(deps: LedgerDeps) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const followers = new Map<string, Follower>();
  let active = 0;
  let warnedHaiku = false;

  // judgment (what waits on you, what was decided) never runs on Haiku
  const model = () => {
    const m = deps.model?.() ?? "";
    if (/haiku/i.test(m)) {
      if (!warnedHaiku)
        console.warn(
          `[ledger] ledgerModel "${m}" ignored: the map never files on Haiku`,
        );
      warnedHaiku = true;
      return "";
    }
    return m;
  };

  function addFollower(c: Conv): Follower {
    const s = db.load(c.root);
    if (!s) throw new Error(`no conversation ${c.root}`);
    const f: Follower = {
      s,
      t: emptyTranscript(),
      file: c.file,
      grewAt: now(),
      turns: [],
      sealed: 0,
      readOnce: false,
      readBusy: false,
      running: null,
      failures: 0,
      retryAt: 0,
      nudged: false,
      lookedForNext: now(),
      snapped: 0,
      lastSweep: 0,
      sealedAt: new Map(),
    };
    followers.set(c.root, f);
    return f;
  }

  // Starts following one of your conversations (or carries on, if it was
  // already), under the first id it had.
  function follow(c: Conversation): string {
    const ids = unique([...(c.previous ?? []), c.id]);
    const t = now();
    const conv: Conv = db.findConv(ids) ?? {
      root: ids[0]!,
      ids: [],
      title: "",
      cwd: "",
      file: "",
      lookedTurn: 0,
      following: true,
      linkedAt: t,
      skipped: 0,
    };
    conv.ids = unique([conv.root, ...conv.ids, ...ids]);
    conv.title = c.title || conv.title;
    conv.cwd = c.cwd || conv.cwd;
    conv.file = c.file || conv.file;
    conv.following = true;
    conv.linkedAt = t;
    db.saveConv(conv);
    const f = followers.get(conv.root);
    if (!f) addFollower(conv);
    else {
      f.s.conv = conv;
      f.s.store.title = conv.title;
      // carried on in another file: read that one from the start
      if (f.file !== conv.file) restart(f, conv.file);
    }
    push(conv.root);
    return conv.root;
  }

  function restart(f: Follower, file: string) {
    f.file = file;
    f.t = emptyTranscript();
    f.readOnce = false;
    f.grewAt = now();
  }

  // the followers marked following when the server last stopped
  function resume() {
    for (const c of db.conversations())
      if (c.following && !followers.has(c.root) && c.file) addFollower(c);
  }

  async function read(f: Follower) {
    if (f.readBusy) return;
    f.readBusy = true;
    const before = { turns: f.turns.length, sealed: f.sealed };
    try {
      let grew = false;
      try {
        const r = await readMore(f.t, f.file);
        grew = r.added > 0 || r.reset;
      } catch {
        if (f.error !== "The chat's transcript can't be read.") {
          f.error = "The chat's transcript can't be read.";
          push(f.s.conv.root);
        }
        return;
      }
      const t = now();
      // read for the first time: still since the file was last written
      if (!f.readOnce) f.grewAt = Math.min(t, mtimeOf(f.file) ?? t);
      else if (grew) f.grewAt = t;
      else if (
        t - f.grewAt > SUCCESSOR_MS &&
        t - f.lookedForNext > SUCCESSOR_MS
      ) {
        f.lookedForNext = t;
        const id = f.s.conv.ids.at(-1) ?? f.s.conv.root;
        const next = (deps.findSuccessor ?? successor)(f.file, id);
        if (next) {
          const conv = f.s.conv;
          conv.ids = unique([...conv.ids, path.basename(next, ".jsonl")]);
          conv.file = next;
          db.saveConv(conv);
          restart(f, next);
          return;
        }
      }
      const v = readView(f.t, t - f.grewAt);
      f.plan = planOf(v.path);
      f.turns = v.turns;
      if (f.readOnce)
        for (const turn of v.turns.slice(before.sealed, v.sealed))
          f.sealedAt.set(turn.n, t);
      f.sealed = v.sealed;
      if (grew) db.setSource(f.file, f.s.conv.root, f.t.offset, t);
      if (!f.readOnce) {
        f.readOnce = true;
        if (f.error === "The chat's transcript can't be read.")
          f.error = undefined;
        recover(f);
        lateLink(f);
      }
      snapChanges(f);
      if (before.turns !== f.turns.length || before.sealed !== f.sealed)
        push(f.s.conv.root);
    } finally {
      f.readBusy = false;
    }
  }

  // A snapshot when following starts, and one after each newly sealed turn;
  // what differs between two in a way the readers see is filed against the
  // turn. Changes from before the chat was followed are not claimed.
  function snapChanges(f: Follower) {
    const ch = deps.changes;
    if (!ch) return;
    if (f.shadow === undefined) {
      f.shadow = ch.shadowFor(f.s.conv.cwd);
      if (f.shadow) f.snap = ch.snapshot(f.shadow, "start") ?? undefined;
      f.snapped = f.sealed;
      return;
    }
    if (!f.shadow || !f.snap || f.sealed <= f.snapped) return;
    const turn = f.turns[f.sealed - 1]?.n ?? f.sealed;
    const next = ch.snapshot(f.shadow, `after turn ${turn}`);
    if (!next) return;
    const r = ch.compare(f.shadow, f.snap, next, turn);
    f.snap = next;
    f.snapped = f.sealed;
    if (!r.statements.length) return;
    db.addChanges(
      f.s.conv.root,
      r.statements.map((s) => ({
        id: crypto
          .createHash("sha1")
          .update(`${s.op}|${s.kind}|${s.key}|${turn}`)
          .digest("hex")
          .slice(0, 12),
        change: s.op,
        kind: s.kind,
        text: s.text,
        module: s.from ?? path.posix.dirname(s.files[0] ?? "."),
        file: s.files[0] ?? "",
        turn,
        low: !!s.low,
      })),
    );
  }

  // Answers saved before a stop that never got applied: applied now, once.
  function recover(f: Follower) {
    for (const run of db.pendingRuns(f.s.conv.root)) {
      // a run that began at the read point filed more of that turn: rebuilt
      // the same way, from how far it had been read
      const more = run.turns[0] === run.base ? continued(f) : null;
      const turns = run.turns.map((n) =>
        more && n === more.n ? more : f.turns.find((t) => t.n === n),
      );
      const answer = checkAnswer(run.answer);
      if (turns.some((t) => !t) || !answer) {
        db.failRun(run.id, "its turns are no longer in the transcript");
        continue;
      }
      if (run.base !== f.s.store.read) {
        db.failRun(run.id, "the map moved on before it was applied");
        continue;
      }
      try {
        commitRun(f, run.id, answer, turns as Turn[]);
      } catch (e) {
        console.error("[ledger] could not apply a saved answer:", e);
      }
    }
  }

  // A long chat linked late is read from its newest turns: reading all of it
  // would take many calls before the map shows anything.
  function lateLink(f: Follower) {
    const { store, conv } = f.s;
    const fresh = store.read === 0 && store.items.size === 0;
    if (fresh && conv.skipped === 0 && f.sealed > LATE_TURNS) {
      conv.skipped = f.sealed - LATE_TURNS;
      store.read = conv.skipped;
      db.commit(
        f.s,
        [{ writer: "extractor", op: { op: "skip", turns: conv.skipped } }],
        now(),
      );
      console.log(
        `[ledger] ${conv.root}: linked late; the newest ${LATE_TURNS} turns are read, ${conv.skipped} earlier ones are skipped for now`,
      );
    }
    if (f.sealed - store.read > BATCH)
      f.backlog = { from: store.read, to: f.sealed };
  }

  const pendingOf = (f: Follower) =>
    f.turns.slice(0, f.sealed).filter((t) => t.n > f.s.store.read);

  // the last filed turn's new part, once that turn is sealed again; a map
  // that doesn't know yet how far it read (filed before this was kept)
  // starts from where the turn is now, so nothing is filed twice
  function continued(f: Follower): Turn | null {
    const read = f.s.store.read;
    const i = f.turns.findIndex((t) => t.n === read);
    if (read <= 0 || i < 0 || i >= f.sealed) return null;
    const t = f.turns[i]!;
    if (!f.s.conv.readExtent) {
      f.s.conv.readExtent = extentOfTurn(t);
      return null;
    }
    return continuationOf(t, f.s.conv.readExtent);
  }

  // anything sealed and not yet filed is due now
  const due = (pending: Turn[]) => pending.length > 0;

  function maybeRun(f: Follower): Promise<void> | null {
    if (f.running) return f.running;
    if (!f.readOnce || !deps.extract || !f.s.conv.following) return null;
    if (active >= MAX_RUNNING) return null;
    if (f.failures && now() < f.retryAt) return null;
    const pending = pendingOf(f);
    const more = continued(f);
    if (!more && !due(pending)) return null;
    f.nudged = false;
    // more of the last filed turn goes first, with what came after it
    const batch = more
      ? [more, ...(batches(pending, BATCH - 1)[0] ?? [])]
      : batches(pending, BATCH)[0]!;
    active++;
    f.filing = { turns: batch.map((t) => t.n), since: now() };
    push(f.s.conv.root);
    f.running = run(f, batch).finally(() => {
      active--;
      f.running = null;
      f.filing = undefined;
      if (f.backlog && f.s.store.read >= f.backlog.to) f.backlog = undefined;
      push(f.s.conv.root);
    });
    return f.running;
  }

  function commitRun(f: Follower, id: number, answer: Answer, turns: Turn[]) {
    const root = f.s.conv.root;
    try {
      const { lines, rejected } = applyAnswer(f.s, answer, turns, now());
      // how far the last turn filed was read: all of it, as it is now
      const last = f.turns.find((t) => t.n === turns.at(-1)?.n);
      if (last) f.s.conv.readExtent = extentOfTurn(last);
      db.commit(f.s, lines, now(), { id, rejected });
    } catch (e) {
      // what is in memory follows what was written
      f.s = db.load(root) ?? f.s;
      throw e;
    }
  }

  async function run(f: Follower, batch: Turn[]) {
    const root = f.s.conv.root;
    const base = f.s.store.read;
    const turns = batch.map((t) => t.n);
    const fail = (error: string) => {
      f.failures++;
      f.retryAt = now() + backoff(f.failures);
      f.error = error;
    };
    try {
      const r = await deps.extract!({
        system: SYSTEM,
        message: message(f.s.store, batch),
        schema: SCHEMA as unknown as Record<string, unknown>,
        model: model(),
        timeoutMs: 120_000,
      });
      const usage = r.usage
        ? {
            usd: r.usage.costUsd,
            input: r.usage.input,
            output: r.usage.output,
            model: r.usage.model,
          }
        : null;
      const answer = r.ok ? checkAnswer(r.value) : null;
      if (!answer) {
        const error = r.ok
          ? "The map's answer was not in the shape asked for."
          : r.error || "The model did not answer.";
        db.saveRun(root, { turns, base, error, usage, ms: r.ms }, now());
        fail(error);
        return;
      }
      // what you did meanwhile stays; only the read point must not have
      // moved (one run per chat at a time keeps it so)
      if (f.s.store.read !== base) {
        db.saveRun(
          root,
          { turns, base, error: "the map moved on", usage, ms: r.ms },
          now(),
        );
        return;
      }
      const id = db.saveRun(
        root,
        { turns, base, answer: r.value, usage, ms: r.ms },
        now(),
      );
      commitRun(f, id, answer, batch);
      f.failures = 0;
      f.retryAt = 0;
      f.error = undefined;
      measure(f, batch, r.ms);
      const store = f.s.store;
      if (store.read - f.lastSweep >= SWEEP_EVERY && quiet(store).length) {
        f.lastSweep = store.read;
        await sweep(f);
      }
    } catch (e) {
      console.error("[ledger] filing turns failed:", e);
      fail("Filing the chat's turns failed on the server.");
    }
  }

  // How long the newest turn of a batch waited between sealing and landing
  // on the map: the lag the page shows, and one log line per run
  function measure(f: Follower, batch: Turn[], modelMs: number) {
    const last = batch.at(-1)!.n;
    const sealed = f.sealedAt.get(last);
    for (const n of f.sealedAt.keys()) if (n <= last) f.sealedAt.delete(n);
    if (sealed === undefined) return;
    const ms = Math.max(0, now() - sealed);
    f.lag = { turn: last, ms, modelMs };
    const s = (x: number) => `${(x / 1000).toFixed(1)}s`;
    console.log(
      `[ledger] ${f.s.conv.root}: filed turn${batch.length === 1 ? "" : "s"} ${batch[0]!.n}${batch.length === 1 ? "" : `–${last}`} ${s(ms)} after turn ${last} sealed (model ${s(modelMs)})`,
    );
  }

  // What waits on you and has gone quiet, checked on its own against the
  // turns since (extract.ts): saved and applied like any run. A failed sweep
  // is left for the next one; it never holds up filing.
  async function sweep(f: Follower) {
    const root = f.s.conv.root;
    const base = f.s.store.read;
    const { message: m, shown } = sweepMessage(
      f.s.store,
      quiet(f.s.store),
      f.turns,
    );
    if (!shown.length) return;
    const r = await deps.extract!({
      system: SWEEP_SYSTEM,
      message: m,
      schema: SCHEMA as unknown as Record<string, unknown>,
      model: model(),
      timeoutMs: 120_000,
    });
    const usage = r.usage
      ? {
          usd: r.usage.costUsd,
          input: r.usage.input,
          output: r.usage.output,
          model: r.usage.model,
        }
      : null;
    const answer = r.ok ? checkAnswer(r.value) : null;
    const turns = shown.map((t) => t.n);
    if (!answer || f.s.store.read !== base) {
      db.saveRun(
        root,
        { turns, base, error: "sweep: no usable answer", usage, ms: r.ms },
        now(),
      );
      return;
    }
    const id = db.saveRun(
      root,
      { turns, base, answer: r.value, usage, ms: r.ms },
      now(),
    );
    commitRun(f, id, answer, shown);
  }

  async function tickOne(f: Follower) {
    await read(f);
    await maybeRun(f);
  }

  // one round for every follower; resolves when what it started is done
  async function tick() {
    await Promise.all([...followers.values()].map(tickOne));
  }

  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  function stateOf(root: string): { s: State; f?: Follower } | null {
    const f = followers.get(root);
    if (f) return { s: f.s, f };
    const s = db.load(root);
    return s ? { s } : null;
  }

  // the side chats open on a chat, as the view lists them (sides.ts sets it)
  let sidesOf: (root: string) => LedgerView["sides"] = () => [];

  function viewOf(root: string): LedgerView | null {
    const hit = stateOf(root);
    if (!hit) return null;
    const { s, f } = hit;
    const read = s.store.read;
    const heardAt = deps.heardAt?.(s.conv) ?? 0;
    return buildView(s, {
      told: new Map(
        [...db.told(root)].map(([id, at]) => [
          id,
          { at, heard: heardAt >= at },
        ]),
      ),
      proposals: db.pendingByItem(root),
      sides: sidesOf(root),
      turns: f?.turns.length ?? read,
      behind: f ? Math.max(0, f.sealed - read) : 0,
      following: s.conv.following,
      error: f?.error,
      reading:
        f?.backlog && f.backlog.to > read
          ? {
              done: read - f.backlog.from,
              total: f.backlog.to - f.backlog.from,
            }
          : undefined,
      filing: f?.filing,
      lag: f?.lag,
      spend: db.spend(root, startOfDay(now())),
      changes: db.changes(root),
      // what Claude is on from its own list, when it keeps one
      ...(f?.plan?.steps.length ? { doing: f.plan.doing } : {}),
    });
  }

  function push(root: string) {
    const v = viewOf(root);
    if (v) deps.emit({ type: "ledger", conv: root, view: v });
  }

  // A change to a chat's items from outside the extractor (you, a side
  // chat's proposal): made on the state in memory, placed, written in one
  // transaction, told to the main chat when it says so, and pushed.
  function change(
    root: string,
    fn: (s: State, turns: number) => Acted,
  ): { error?: string; view?: LedgerView } {
    const hit = stateOf(root);
    if (!hit) return { error: "That chat is not on the map." };
    const { s, f } = hit;
    const r = fn(s, f?.turns.length ?? s.store.read);
    if (r.error) {
      // nothing written: what is in memory follows what was
      if (f) f.s = db.load(root) ?? f.s;
      return { error: r.error };
    }
    place(s, now());
    try {
      db.commit(s, r.lines, now());
    } catch (e) {
      if (f) f.s = db.load(root) ?? f.s;
      throw e;
    }
    if (r.tell) {
      deps.tell?.(s.conv, r.tell, r.quiet);
      if (r.about) db.setTold(root, r.about, now());
    }
    push(root);
    return { view: viewOf(root) ?? undefined };
  }

  // What you did on the map: written as "you" at once; what the chat should
  // hear (an answer, a pick, a tick) goes to it at once too.
  function act(root: string, action: LedgerAction) {
    return change(root, (s, turns) => {
      const r = applyAction(s, action, turns);
      return "item" in action && r.tell ? { ...r, about: action.item } : r;
    });
  }

  // a chat's turns as the follower last read them (null: not followed now)
  const turnsOf = (root: string): Turn[] | null =>
    followers.get(root)?.turns ?? null;

  // the page opened on this chat: what waits is filed now
  function nudge(root: string) {
    const f = followers.get(root);
    if (f) f.nudged = true;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  if (deps.everyMs !== 0) {
    timer = setInterval(() => {
      for (const f of followers.values())
        void tickOne(f).catch((e) =>
          console.error("[ledger] following failed:", e),
        );
    }, deps.everyMs ?? TICK_MS);
    timer.unref?.();
  }

  return {
    follow,
    resume,
    tick,
    view: viewOf,
    act,
    change,
    turnsOf,
    state: (root: string) => stateOf(root)?.s ?? null,
    nudge,
    push,
    useSides(fn: (root: string) => LedgerView["sides"]) {
      sidesOf = fn;
    },
    // the main chat with this session id took its inbox: its cards say so
    heard(session: string) {
      const root = db.findConv([session])?.root;
      if (root) push(root);
    },
    // the conversation any of these ids is filed under
    rootOf: (ids: string[]) => db.findConv(unique(ids))?.root ?? null,
    // the one linked last
    latest: () => db.conversations()[0]?.root ?? null,
    conversations: () => db.conversations(),
    following: () => [...followers.keys()],
    close() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type Ledger = ReturnType<typeof createLedger>;
