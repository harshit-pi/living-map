// What the main chat should hear from its map (an answer you sent, an option
// you picked, a side chat's finding you applied), kept per chat in
// ~/.living-map/conversations/<first id>.json. The chat reads it through the
// living-map hook with your next message (POST /api/inbox), or at once
// through the listener it keeps running (GET /api/inbox/wait), which wakes
// for anything marked `wake`.

import fs from "node:fs";
import path from "node:path";

import { HOME } from "../server/config.ts";

export const OUTBOX_DIR = path.join(HOME, "conversations");
const KEEP = 40;
const isId = (id: string) => /^[\w-]{1,80}$/.test(id);

export type Outgoing = { ts: number; text: string; wake?: boolean };
export type Outbox = {
  id: string; // the chat's first id (it gets a new one when resumed)
  aliases: string[]; // every id it has had
  title: string;
  outbox: Outgoing[];
  sent: number; // how many of outbox the chat has heard
  heardAt?: number; // when it last took them
};

const cache = new Map<string, Outbox>();
const fileOf = (id: string, dir: string) => path.join(dir, `${id}.json`);

function read(id: string, dir: string): Outbox | null {
  if (!isId(id)) return null;
  const hit = cache.get(`${dir}/${id}`);
  if (hit) return hit;
  try {
    const raw = JSON.parse(
      fs.readFileSync(fileOf(id, dir), "utf8"),
    ) as Partial<Outbox>;
    const o: Outbox = {
      id,
      aliases: Array.isArray(raw.aliases)
        ? raw.aliases.filter((a) => typeof a === "string")
        : [id],
      title: typeof raw.title === "string" ? raw.title : "",
      outbox: Array.isArray(raw.outbox) ? raw.outbox : [],
      sent: typeof raw.sent === "number" ? raw.sent : 0,
      ...(typeof raw.heardAt === "number" ? { heardAt: raw.heardAt } : {}),
    };
    cache.set(`${dir}/${id}`, o);
    return o;
  } catch {
    return null;
  }
}

function save(o: Outbox, dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(fileOf(o.id, dir), JSON.stringify(o), { mode: 0o600 });
  } catch (e) {
    console.error("[outbox] could not save:", e);
  }
}

// a chat's outbox by its ids, oldest first: made on first use
export function outboxOf(ids: string[], title = "", dir = OUTBOX_DIR): Outbox {
  const first = ids[0]!;
  const o = read(first, dir) ?? {
    id: first,
    aliases: [],
    title,
    outbox: [],
    sent: 0,
  };
  cache.set(`${dir}/${first}`, o);
  for (const id of ids) if (!o.aliases.includes(id)) o.aliases.push(id);
  if (title) o.title = title;
  return o;
}

// the outbox a session id names: its own, or the one it went on from when
// it was resumed
function forSession(session: string, dir: string): Outbox | null {
  if (!isId(session)) return null;
  const direct = read(session, dir);
  if (direct) return direct;
  for (const [k, o] of cache)
    if (k.startsWith(`${dir}/`) && o.aliases.includes(session)) return o;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of names) {
    if (!f.endsWith(".json")) continue;
    const o = read(f.slice(0, -5), dir);
    if (o?.aliases.includes(session)) return o;
  }
  return null;
}

export function post(
  ids: string[],
  title: string,
  text: string,
  wake: boolean,
  dir = OUTBOX_DIR,
  now = Date.now(),
) {
  const o = outboxOf(ids, title, dir);
  o.outbox.push({
    ts: now,
    text: text.length > 1500 ? `${text.slice(0, 1499)}…` : text,
    ...(wake ? { wake } : {}),
  });
  const extra = o.outbox.length - KEEP;
  if (extra > 0) {
    o.outbox.splice(0, extra);
    o.sent = Math.max(0, o.sent - extra);
  }
  save(o, dir);
}

// when the chat last took its inbox (0: never)
export const heardAt = (ids: string[], dir = OUTBOX_DIR) =>
  outboxOf(ids, "", dir).heardAt ?? 0;

// something the chat should hear now is waiting: the listener's wait ends
export function wakesFor(session: string, dir = OUTBOX_DIR): boolean {
  const o = forSession(session, dir);
  return !!o && o.outbox.slice(o.sent).some((m) => m.wake);
}

// what the chat has not heard yet, marked heard; "" when nothing
export function unsentFor(
  session: string,
  dir = OUTBOX_DIR,
  now = Date.now(),
): string {
  const o = forSession(session, dir);
  if (!o) return "";
  const out = o.outbox.slice(o.sent);
  if (!out.length) return "";
  o.sent = o.outbox.length;
  o.heardAt = now;
  save(o, dir);
  return out.map((m) => `- ${m.text}`).join("\n");
}
