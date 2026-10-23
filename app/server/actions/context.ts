// What every action gets: the engine, the model settings for this request,
// and a few helpers for the open map.

import { fromView } from "../../layer/view.ts";
import type { ActionResult, MapNode, Settings } from "../../shared/model.ts";
import { own, type StoredMap } from "../core/types.ts";
import type { Engine, TurnOptions } from "../engine.ts";

export type Ctx = {
  engine: Engine;
  settings: Settings;
  map: StoredMap;
  // what you wrote goes into a thread (or the main conversation) at once
  say: (text: string, threadId?: string | null) => void;
  // a node by id with the label the model sees, or null
  node: (id: string) => { node: MapNode; named: string } | null;
  // a change you made on the canvas, told to the model with its next move
  note: (text: string) => void;
};

export function makeCtx(
  engine: Engine,
  settings: Settings,
  map: StoredMap,
): Ctx {
  return {
    engine,
    settings,
    map,
    say(text, threadId = null) {
      engine
        .threadOf(map, threadId)
        .push({ role: "you", text, ts: Date.now() });
      engine.push();
    },
    node(id) {
      const node = own(map.nodes, id);
      return node ? { node, named: `[${id}] "${node.title}"` } : null;
    },
    note(text) {
      map.notes.push(text);
      // the main chat hears what you did on a view of its map
      if (map.conversation) fromView(map, text);
    },
  };
}

// A move whose whole point is a node's detail (an explanation, a shown answer):
// if the reply did not deliver it, ask once more, plainly, before giving up.
export async function withDetail(
  ctx: Ctx,
  nodeId: string,
  action: string,
  opts: TurnOptions,
): Promise<ActionResult> {
  const r = await ctx.engine.turn(action, ctx.settings, opts);
  if (
    r.error ||
    r.stopped ||
    !own(ctx.map.nodes, nodeId) ||
    ctx.map.nodes[nodeId].detail
  )
    return r;
  return ctx.engine.turn(
    `${action} Your previous reply did not deliver it: send the map block again as valid JSON, with the update op on "${nodeId}" carrying the "detail".`,
    ctx.settings,
    { ...opts, label: `${opts.label ?? "Thinking"} (second try)` },
  );
}

export const hintCount = (map: StoredMap, nodeId: string) =>
  Object.values(map.nodes).filter(
    (n) => n.parent === nodeId && /^hint\b/i.test(n.title),
  ).length;
