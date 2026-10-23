// The conversation layer on disk: one file per conversation in
// ~/.living-map/conversations/, beside the page any conversation can read
// (<id>.md). Kept in memory once read, so every view of a conversation works
// on the same one.

import fs from "node:fs";
import path from "node:path";

import { contextPage, newState, type LayerState } from "./core.ts";
import { HOME } from "../server/config.ts";
import type { Conversation } from "../server/providers/types.ts";

export const LAYER_DIR = path.join(HOME, "conversations");
const isId = (id: string) => /^[\w-]{1,80}$/.test(id);

const cache = new Map<string, LayerState>();

// the id a conversation's layer is kept under: its first one, so resuming it
// under a new id keeps the same layer
export const layerId = (c: Conversation) => c.previous?.[0] ?? c.id;

const fileOf = (id: string) => path.join(LAYER_DIR, `${id}.json`);
export const pageOf = (id: string) => path.join(LAYER_DIR, `${id}.md`);

function read(id: string): LayerState | null {
  if (!isId(id)) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  try {
    const s = {
      ...newState(id),
      ...JSON.parse(fs.readFileSync(fileOf(id), "utf8")),
    } as LayerState;
    cache.set(id, s);
    return s;
  } catch {
    return null;
  }
}

// a conversation's layer, made on first use
export function layerOf(c: Conversation): LayerState {
  const id = layerId(c);
  const s = read(id) ?? newState(id, c.title);
  cache.set(id, s);
  if (c.title) s.title = c.title;
  return s;
}

// the layer for a session id the hook names: its own, or the one it went on
// from when it was resumed
export function layerForSession(sessionId: string): LayerState | null {
  if (!isId(sessionId)) return null;
  const direct = read(sessionId);
  if (direct) return direct;
  for (const s of cache.values()) if (s.aliases?.includes(sessionId)) return s;
  let names: string[];
  try {
    names = fs.readdirSync(LAYER_DIR);
  } catch {
    return null;
  }
  for (const f of names) {
    if (!f.endsWith(".json")) continue;
    const s = read(f.slice(0, -5));
    if (s?.aliases?.includes(sessionId)) return s;
  }
  return null;
}

export function saveLayer(s: LayerState) {
  if (!isId(s.id)) return;
  try {
    fs.mkdirSync(LAYER_DIR, { recursive: true });
    fs.writeFileSync(fileOf(s.id), JSON.stringify(s));
    fs.writeFileSync(pageOf(s.id), contextPage(s));
  } catch (e) {
    console.error("[layer] could not save:", e);
  }
}
