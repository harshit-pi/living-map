// Following your conversation, whichever view of it is open: the transcript
// is read as it grows, and the layer catches up with a short move of its own
// that is sent only the new turns (it does not resume the conversation, so
// it costs the same however long the conversation gets).

import fs from "node:fs";
import path from "node:path";

import { batchEnd, readTurns, shouldFollow, type LayerState } from "./core.ts";
import { LAYER } from "./prompt.ts";
import { layerOf, saveLayer } from "./store.ts";
import type { StoredMap } from "../server/core/types.ts";
import type { Engine } from "../server/engine.ts";
import {
  conversationFile,
  successor,
} from "../server/providers/claude-sessions.ts";
import type { ActionResult, Settings } from "../shared/model.ts";

// Catching up is a background move nobody waits on: a quick model is enough
// to file what was said. LIVING_MAP_FOLLOW_MODEL picks another.
export const FOLLOW_SETTINGS: Settings = {
  model: process.env.LIVING_MAP_FOLLOW_MODEL ?? "sonnet",
  effort: "low",
};

export const FOLLOWING = "Following your chat";

// how much of the transcript is read per tick, and of a long one linked for
// the first time
const CHUNK = 8 * 1024 * 1024;
const FIRST_READ = 16 * 1024 * 1024;

// when each layer last looked for its conversation going on in another file
const lookedAt = new WeakMap<LayerState, number>();

export const layerFor = (map: StoredMap): LayerState | null =>
  map.conversation ? layerOf(map.conversation) : null;

// Read what the transcript gained since last time; true when there are new
// turns. Only whole lines are read: the last one may still be being written.
export function readNew(map: StoredMap, now = Date.now()): boolean {
  const conv = map.conversation;
  if (!conv) return false;
  const s = layerOf(conv);
  const file = conversationFile(conv.id) ?? conv.file ?? "";
  if (!file) return false;
  // moved (another folder): read it from the start
  if (file !== s.file) {
    s.file = file;
    s.offset = 0;
    conv.file = file;
  }
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false;
  }
  if (size < s.offset) s.offset = 0; // rewritten from the start
  if (size === s.offset) {
    // quiet: perhaps resumed, going on under a new id in another file
    if (now - (lookedAt.get(s) ?? 0) > 15_000) {
      lookedAt.set(s, now);
      const next = successor(file, conv.id);
      if (next) {
        const id = path.basename(next, ".jsonl");
        conv.previous = [...(conv.previous ?? []), conv.id];
        conv.id = id;
        conv.file = next;
        if (!s.aliases.includes(id)) s.aliases.push(id);
        s.file = next;
        s.offset = 0;
        return readNew(map, now);
      }
    }
    return false;
  }
  // read again from the start, what is older than the last turn read was
  // read before (and the entries already seen are skipped too)
  const since = s.offset === 0 ? (s.turns.at(-1)?.ts ?? 0) : 0;
  // a very long conversation linked for the first time is followed from its
  // last part: reading all of it would hold the server up for seconds
  let partial = false;
  if (s.offset === 0 && !s.turns.length && size > FIRST_READ) {
    s.offset = size - FIRST_READ;
    partial = true;
  }
  // a bounded piece per tick, so the server keeps answering meanwhile
  const buf = Buffer.alloc(Math.min(size - s.offset, CHUNK));
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buf, 0, buf.length, s.offset);
  } finally {
    fs.closeSync(fd);
  }
  const end = buf.lastIndexOf(10);
  if (end < 0) {
    // one line longer than a whole piece is no turn worth reading: skipped
    if (buf.length === CHUNK) s.offset += buf.length;
    return false;
  }
  // started mid-line: that line's start was never read
  const from = partial ? buf.indexOf(10) + 1 : 0;
  const text = buf.subarray(from, end).toString("utf8");
  s.offset += end + 1;
  s.activeAt = now;
  const seen = new Set(s.seen);
  const added = readTurns(text.split("\n"), s.turns, seen, now, since);
  // a file read again is also cut off by time (since): the newest few
  // thousand entries are enough to skip the rest, and keep the layer small
  s.seen = [...seen].slice(-5000);
  return added > 0;
}

// layers with a catch-up queued or running: one at a time, so the turns a
// move was sent are the ones it records
const catching = new WeakSet<LayerState>();

// One catch-up: the layer is sent the turns it has not seen (a batch at a
// time) and files them. It runs on whichever map of the conversation is open.
export async function catchUp(
  engine: Engine,
  map: StoredMap,
  { label = FOLLOWING } = {},
): Promise<ActionResult> {
  const s = layerFor(map);
  if (!s || catching.has(s)) return {};
  const upTo = batchEnd(s);
  if (upTo <= s.mapped) return {};
  const gen = s.gen;
  catching.add(s);
  s.upTo = upTo;
  s.heldAt = 0;
  try {
    const r = await engine.turn(
      `FOLLOW: bring the layer up to date with the conversation's new turns (NEW IN THE CONVERSATION below).`,
      FOLLOW_SETTINGS,
      {
        as: LAYER,
        label,
        sections: ["follow"],
        quiet: true,
        unlinked: true,
      },
    );
    if (r.stopped) s.heldAt = s.turns.length;
    if (r.ok && s.gen === gen) {
      s.mapped = Math.max(s.mapped, upTo);
      s.syncedAt = Date.now();
    }
    saveLayer(s);
    if (engine.state.map === map) engine.push();
    return r;
  } finally {
    catching.delete(s);
  }
}

// a catch-up that did not come back is tried again later and later; after
// this many in a row following pauses, and the rail says why
const GIVE_UP = 6;
const backoff = (failures: number) =>
  failures ? Math.min(10 * 60_000, 30_000 * 2 ** (failures - 1)) : 0;

// Watches the open map's conversation: new turns show at once (the rail's
// latest line), and the layer catches up when it is time.
export function follow(engine: Engine, everyMs = 2000) {
  let running = false;
  let failures = 0;
  let failedAt = 0;
  const tick = async () => {
    const m = engine.state.map;
    if (!m?.conversation || running) return;
    running = true;
    try {
      const s = layerOf(m.conversation);
      if (readNew(m)) {
        saveLayer(s);
        engine.push();
      }
      // a catch-up waits for the map to be free: what you asked goes first
      if (
        shouldFollow(s, Date.now()) &&
        Date.now() - failedAt > backoff(failures) &&
        !engine.state.busy &&
        !engine.state.waiting.length
      ) {
        const r = await catchUp(engine, m);
        if (r.ok || r.stopped) failures = 0;
        else {
          failures++;
          failedAt = Date.now();
          if (failures >= GIVE_UP) {
            failures = 0;
            s.following = false;
            s.pausedWhy =
              "Claude did not answer several times in a row. Turn following back on once it answers again.";
            saveLayer(s);
            engine.push();
          }
        }
      }
    } catch (e) {
      console.error("[layer] following the conversation failed:", e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
