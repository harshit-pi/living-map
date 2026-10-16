// What every action gets: the engine, the model settings for this request,
// and a few helpers for the open map.

import type { MapNode, Settings } from "../../shared/model.ts";
import type { StoredMap } from "../core/types.ts";
import type { Engine } from "../engine.ts";

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
      const node = map.nodes[id];
      return node ? { node, named: `[${id}] "${node.title}"` } : null;
    },
    note(text) {
      map.notes.push(text);
    },
  };
}

export const hintCount = (map: StoredMap, nodeId: string) =>
  Object.values(map.nodes).filter(
    (n) => n.parent === nodeId && /^hint\b/i.test(n.title),
  ).length;
