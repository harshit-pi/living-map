// Maps on disk: one JSON file each, plus which one is open.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { now } from "./clock.ts";
import { CURRENT_FILE, MAPS_DIR } from "./config.ts";
import type { StoredMap } from "./core/types.ts";
import { pluginFor } from "./plugins.ts";
import type { MapSummary, Purpose } from "../shared/model.ts";

const fileOf = (id: string) => path.join(MAPS_DIR, `${id}.json`);
const isId = (id: string) => /^[\w-]+$/.test(id);

export function newMap(title: string, purpose: Purpose): StoredMap {
  return {
    id: randomUUID().slice(0, 8),
    title,
    purpose,
    createdAt: Date.now(),
    nodes: {},
    chat: [],
    threads: {},
    diagram: null,
    fills: {},
    scenes: {},
    play: {},
    notes: [],
    usage: { turns: 0, input: 0, output: 0, costUsd: 0, last: null },
  };
}

// Older maps miss newer fields; "decide" maps are now "explore".
export function normalise(
  m: Partial<StoredMap> & { purpose?: string },
): StoredMap {
  return {
    ...newMap(m.title ?? "Untitled", "explore"),
    ...m,
    // a plugin's purpose is kept as is; one that is no longer installed opens as explore
    purpose:
      m.purpose &&
      m.purpose !== "decide" &&
      /^[a-z][a-z0-9-]{1,30}$/.test(m.purpose)
        ? m.purpose
        : "explore",
    threads: m.threads ?? {},
    fills: m.fills ?? {},
    diagram: m.diagram ?? null,
    scenes: m.scenes ?? {},
    play: m.play ?? {},
    notes: m.notes ?? [],
  } as StoredMap;
}

export function readMap(id: string): StoredMap | null {
  if (!isId(id)) return null;
  try {
    return normalise(JSON.parse(fs.readFileSync(fileOf(id), "utf8")));
  } catch {
    return null;
  }
}

export function loadCurrent(): StoredMap | null {
  try {
    return readMap(fs.readFileSync(CURRENT_FILE, "utf8").trim());
  } catch {
    return null;
  }
}

export function saveMap(m: StoredMap, { current = true } = {}) {
  fs.writeFileSync(fileOf(m.id), JSON.stringify(m, null, 1));
  if (current) fs.writeFileSync(CURRENT_FILE, m.id);
}

// The newest map linked to this conversation of yours, if there is one.
export function findLinked(conversationId: string): StoredMap | null {
  let best: { m: StoredMap; at: number } | null = null;
  for (const f of fs.readdirSync(MAPS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const m = readMap(f.slice(0, -5));
    if (m?.conversation?.id !== conversationId) continue;
    const at = fs.statSync(path.join(MAPS_DIR, f)).mtimeMs;
    if (!best || at > best.at) best = { m, at };
  }
  return best?.m ?? null;
}

// Every saved map, newest first, for the Maps list and the start screen.
export function listMaps(currentId: string | null): MapSummary[] {
  const out: MapSummary[] = [];
  for (const f of fs.readdirSync(MAPS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const m = readMap(f.slice(0, -5));
    if (!m) continue;
    const nodes = Object.values(m.nodes);
    if (!nodes.length && !m.diagram) continue;
    const steps = nodes.filter((n) => n.kind === "question" && n.parent);
    // a mode words its own line (Learn: how much of the path you worked out)
    const summary = pluginFor(m.purpose)?.summary?.(m);
    // a mode with spaced review says what is due (the start screen's strip)
    const due = pluginFor(m.purpose)?.due?.(m, now());
    out.push({
      id: m.id,
      title: m.title,
      purpose: m.purpose,
      updatedAt: fs.statSync(path.join(MAPS_DIR, f)).mtimeMs,
      nodes: nodes.length,
      open: steps.filter((n) => n.status === "open").length,
      done: steps.filter((n) => n.status === "answered").length,
      current: m.id === currentId,
      ...(m.conversation ? { linked: true } : {}),
      ...(summary ? { summary } : {}),
      ...(due ? { due } : {}),
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
