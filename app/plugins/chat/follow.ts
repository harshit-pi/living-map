// Chat following your conversation: the transcript is read as it grows, and
// the map catches up with a short move of its own that is sent only the new
// turns (it does not resume the conversation, so it costs the same however
// long the conversation gets). After each catch-up the context page is
// written, for any conversation to read.

import fs from "node:fs";
import path from "node:path";

import {
  batchEnd,
  contextPage,
  newState,
  readTurns,
  shouldFollow,
  type ChatState,
} from "./core.ts";
import { PLUGIN_ID } from "./shared.ts";
import { HOME } from "../../server/config.ts";
import type { StoredMap } from "../../server/core/types.ts";
import type { Engine } from "../../server/engine.ts";
import { stateOf } from "../../server/plugin.ts";
import {
  conversationFile,
  successor,
} from "../../server/providers/claude-sessions.ts";
import type { ActionResult, Settings } from "../../shared/model.ts";

export const chatState = (map: StoredMap) =>
  stateOf<ChatState>(map, PLUGIN_ID, newState);

// Catching up is a background move nobody waits on: a quick model is enough
// to file what was said. LIVING_MAP_FOLLOW_MODEL picks another.
export const FOLLOW_SETTINGS: Settings = {
  model: process.env.LIVING_MAP_FOLLOW_MODEL ?? "sonnet",
  effort: "low",
};

export const FOLLOWING = "Following your chat";

// when each map last looked for its conversation going on in another file
const lookedAt = new WeakMap<StoredMap, number>();

// how much of the transcript is read per tick, and of a long one linked for
// the first time
const CHUNK = 8 * 1024 * 1024;
const FIRST_READ = 16 * 1024 * 1024;

const CONTEXT_DIR = path.join(HOME, "conversations");

export const contextFile = (map: StoredMap) =>
  map.conversation ? path.join(CONTEXT_DIR, `${map.conversation.id}.md`) : null;

export function writeContext(map: StoredMap) {
  const file = contextFile(map);
  if (!file) return;
  try {
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
    fs.writeFileSync(file, contextPage(map, chatState(map)));
  } catch (e) {
    console.error("[chat] could not write the context page:", e);
  }
}

// Read what the transcript gained since last time; true when there are new
// turns. Only whole lines are read: the last one may still be being written.
export function readNew(map: StoredMap, now = Date.now()): boolean {
  const conv = map.conversation;
  if (!conv) return false;
  const s = chatState(map);
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
    if (now - (lookedAt.get(map) ?? 0) > 15_000) {
      lookedAt.set(map, now);
      const next = successor(file, conv.id);
      if (next) {
        conv.previous = [...(conv.previous ?? []), conv.id];
        conv.id = path.basename(next, ".jsonl");
        conv.file = next;
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
  // a very long conversation linked for the first time is mapped from its
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
  // thousand entries are enough to skip the rest, and keep the map small
  s.seen = [...seen].slice(-5000);
  return added > 0;
}

// maps with a catch-up queued or running: one at a time, so the turns a move
// was sent are the ones it records
const catching = new WeakSet<StoredMap>();

// One catch-up: the map is sent the turns it has not seen (a batch at a time)
// and files them.
export async function catchUp(
  engine: Engine,
  map: StoredMap,
): Promise<ActionResult> {
  const s = chatState(map);
  if (catching.has(map)) return {};
  const upTo = batchEnd(s);
  if (upTo <= s.mapped) return {};
  const gen = s.gen;
  catching.add(map);
  s.upTo = upTo;
  s.heldAt = 0;
  try {
    const r = await engine.turn(
      `FOLLOW: bring the map up to date with the conversation's new turns (NEW IN THE CONVERSATION below).`,
      FOLLOW_SETTINGS,
      {
        label: FOLLOWING,
        sections: ["follow"],
        quiet: true,
        unlinked: true,
      },
    );
    if (r.stopped) s.heldAt = s.turns.length;
    if (r.ok && s.gen === gen) {
      s.mapped = Math.max(s.mapped, upTo);
      s.syncedAt = Date.now();
      writeContext(map);
      if (engine.state.map === map) engine.push();
    }
    return r;
  } finally {
    catching.delete(map);
  }
}

// a catch-up that did not come back is tried again later and later; after
// this many in a row following pauses, and the map says why
const GIVE_UP = 6;
const backoff = (failures: number) =>
  failures ? Math.min(10 * 60_000, 30_000 * 2 ** (failures - 1)) : 0;

// Watches the open map's conversation while it is a Chat map: new turns are
// shown at once (the recent lines), and the map catches up when it is time.
export function follow(engine: Engine, everyMs = 2000) {
  let running = false;
  let failures = 0;
  let failedAt = 0;
  const tick = async () => {
    const m = engine.state.map;
    if (!m || m.purpose !== PLUGIN_ID || !m.conversation || running) return;
    running = true;
    try {
      if (readNew(m)) engine.push();
      const s = chatState(m);
      // a catch-up waits for the map to be free: a side chat you asked for
      // goes first
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
            m.chat.push({
              role: "system",
              text: "Following paused: Claude did not answer several times in a row. Turn it back on from ⋯ once it answers again.",
              ts: Date.now(),
            });
            engine.push();
          }
        }
      }
    } catch (e) {
      console.error("[chat] following the conversation failed:", e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
