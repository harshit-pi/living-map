// The contract a plugin implements on the server. Core keeps the map, the move
// queue, threads, the model and updates; a plugin adds one way of working on
// the canvas (Design is the first): what the model is told, the ops it may
// write, the actions the browser may send, and what of its state the browser
// sees. A plugin's state lives in map.data[plugin.id].

import type { ActionResult } from "../shared/model.ts";
import type { Ctx } from "./actions/context.ts";
import type { Raw, StoredMap } from "./core/types.ts";

export type ServerPlugin = {
  // also the map's purpose, e.g. "design"
  id: string;
  label: string;
  // the model's job on this canvas, sent on every move (with core's map ops)
  prompt: string;
  // extra instructions by name, sent only on moves that list them in `sections`
  sections?: Record<string, string>;
  // what the model is told about the plugin's state on every move
  outline?: (map: StoredMap) => string;
  // an op from the model's reply that core does not know; return how many
  // things it changed, or null when it is not this plugin's op either. The
  // model's output is untrusted: clean every field before it reaches the map.
  applyOp?: (
    map: StoredMap,
    op: Raw,
    opts: { scope: string | null },
  ) => number | null;
  // the first move on a new map of this purpose
  start: (ctx: Ctx) => Promise<ActionResult>;
  // actions the browser sends as {type: "plugin", plugin: id, name, args}
  actions?: Record<
    string,
    (ctx: Ctx, args: Raw) => Promise<ActionResult> | ActionResult
  >;
  // the state the browser may see; leave out anything the user should work out
  view?: (map: StoredMap) => unknown;
  // one line for the maps list, e.g. "7 parts · 6 wires"
  summary?: (map: StoredMap) => string;
};

// a plugin's state on a map, created on first use
export function stateOf<T extends object>(
  map: StoredMap,
  id: string,
  init: () => T,
): T {
  map.data ??= {};
  const cur = map.data[id];
  if (cur && typeof cur === "object") return cur as T;
  const fresh = init();
  map.data[id] = fresh;
  return fresh;
}
