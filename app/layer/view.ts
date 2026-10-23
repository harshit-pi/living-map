// What the browser sees of the conversation layer beside a view, and what
// the main chat hears of what you did on it. Kept apart from the rail's
// actions: the plugins' own modules import this, and the actions import them.

import {
  claudeTodo,
  decided,
  needsYou,
  post,
  postFromView,
  stillOpen,
  takeUnsent,
  wakes,
} from "./core.ts";
import { layerFor } from "./follow.ts";
import { LAYER_ID, REFRESH, type LayerView } from "./shared.ts";
import { layerForSession, pageOf, saveLayer } from "./store.ts";
import type { StoredMap } from "../server/core/types.ts";

// when this map's view last heard from the model: turns after it are what
// the view has not taken in
function lastMove(map: StoredMap): number {
  let at = map.createdAt;
  for (const c of map.chat) if (c.role === "claude") at = Math.max(at, c.ts);
  for (const t of Object.values(map.threads))
    for (const c of t.messages)
      if (c.role === "claude") at = Math.max(at, c.ts);
  return at;
}

function viewOf(map: StoredMap): LayerView | undefined {
  const s = layerFor(map);
  if (!s) return undefined;
  const since = lastMove(map);
  const now = Date.now();
  return {
    items: s.items,
    lanes: {
      you: needsYou(s).map((i) => i.id),
      claude: claudeTodo(s).map((i) => i.id),
      open: stillOpen(s).map((i) => i.id),
      decided: decided(s).map((i) => i.id),
    },
    sides: Object.values(s.sides).sort((a, b) => a.createdAt - b.createdAt),
    latest: s.turns.at(-1) ?? null,
    turns: s.turns.filter((t) => t.who === "you").length,
    mapped: s.turns.slice(0, s.mapped).filter((t) => t.who === "you").length,
    following: s.following,
    syncedAt: s.syncedAt,
    summary: s.summary,
    now: s.now,
    suggested: s.suggested,
    behind: s.turns.filter((t) => t.who === "you" && t.ts > since).length,
    unsent: s.outbox.length - s.sent,
    listening: listening.has(s.id),
    told: (s.told ?? []).slice(-5).map((t) => ({
      ...t,
      heard: !!s.heardAt && s.heardAt >= t.ts,
    })),
    fresh: Object.values(s.items)
      .filter((i) => !i.byYou && now - i.updatedAt < 3 * 60_000)
      .map((i) => i.id),
    ...(s.pausedWhy && !s.following ? { pausedWhy: s.pausedWhy } : {}),
  };
}

// What you wrote on a view and what it answered, for the main chat: an
// answer given there ("yes, push it") is meant for it as much as for the view.
function heard(
  map: StoredMap,
  move: { said: string; answer: string; on: string | null },
) {
  if (move.said === REFRESH) return;
  const s = layerFor(map);
  if (!s) return;
  const where = `${move.on ? `in the thread on "${move.on}" ` : ""}on the ${labelOf(map.purpose)} view of the map`;
  post(
    s,
    `The user wrote ${where}: "${move.said}"${move.answer ? `\nThe map answered: ${move.answer}` : ""}`,
    Date.now(),
    true,
  );
  saveLayer(s);
}

export const follow = { id: LAYER_ID, view: viewOf, heard };

// the view's name as you see it (a mode a plugin adds keeps its id)
const VIEW_NAME: Record<string, string> = {
  explore: "Explore",
  learn: "Learn",
  design: "Design",
};
const labelOf = (mode: string) => VIEW_NAME[mode] ?? mode;

// What you did on a view of a linked map, for the main chat to hear.
export function fromView(map: StoredMap, text: string) {
  // switching views is how you look, not something you did
  if (/^Switched the canvas to /.test(text)) return;
  const s = layerFor(map);
  if (!s) return;
  postFromView(s, labelOf(map.purpose), text);
  saveLayer(s);
}

// What the main chat has not heard from its maps (side chats, ticks, what
// you did on its views), marked heard. "" when nothing, or no layer.
// listeners waiting in each conversation's main chat, by layer id: the rail
// says whether what you send wakes it now or waits for your next message
const listening = new Map<string, number>();
export function listen(sessionId: string, delta: 1 | -1) {
  const s = layerForSession(sessionId);
  if (!s) return;
  const n = (listening.get(s.id) ?? 0) + delta;
  if (n > 0) listening.set(s.id, n);
  else listening.delete(s.id);
}

// something for the main chat to hear now: the listener's wait ends
export function wakesFor(sessionId: string): boolean {
  const s = layerForSession(sessionId);
  return !!s && wakes(s);
}

export function unsentFor(sessionId: string): string {
  const s = layerForSession(sessionId);
  if (!s) return "";
  const out = takeUnsent(s);
  if (!out.length) return "";
  s.heardAt = Date.now();
  saveLayer(s);
  return [
    ...out.map((o) => `- ${o.text}`),
    `(Everything the map holds: ${pageOf(s.id)})`,
  ].join("\n");
}
