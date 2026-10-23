// What the browser sees of the conversation layer beside a view, and what
// the main chat hears of what you did on it. Kept apart from the rail's
// actions: the plugins' own modules import this, and the actions import them.

import {
  claudeTodo,
  decided,
  needsYou,
  postFromView,
  stillOpen,
  takeUnsent,
} from "./core.ts";
import { layerFor } from "./follow.ts";
import { LAYER_ID, type LayerView } from "./shared.ts";
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
    fresh: Object.values(s.items)
      .filter((i) => !i.byYou && now - i.updatedAt < 3 * 60_000)
      .map((i) => i.id),
    ...(s.pausedWhy && !s.following ? { pausedWhy: s.pausedWhy } : {}),
  };
}

export const follow = { id: LAYER_ID, view: viewOf };

// the view's name as you see it (a mode a plugin adds keeps its id)
const VIEW_NAME: Record<string, string> = {
  explore: "Explore",
  learn: "Learn",
  design: "Design",
};
const labelOf = (mode: string) => VIEW_NAME[mode] ?? mode;

// What you did on a view of a linked map, for the main chat to hear.
export function fromView(map: StoredMap, text: string) {
  const s = layerFor(map);
  if (!s) return;
  postFromView(s, labelOf(map.purpose), text);
  saveLayer(s);
}

// What the main chat has not heard from its maps (side chats, ticks, what
// you did on its views), marked heard. "" when nothing, or no layer.
export function unsentFor(sessionId: string): string {
  const s = layerForSession(sessionId);
  if (!s) return "";
  const out = takeUnsent(s);
  if (!out.length) return "";
  saveLayer(s);
  return [
    ...out.map((o) => `- ${o.text}`),
    `(Everything the map holds: ${pageOf(s.id)})`,
  ].join("\n");
}
