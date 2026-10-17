// The contract a plugin implements on the server. Core keeps the map, the move
// queue, threads, the model and updates; a plugin adds one way of working on
// the canvas (Explore, Learn and Design are plugins): what the model is told,
// the ops it may write, the actions the browser may send, and what of its
// state the browser sees. A plugin's state lives in map.data[plugin.id]
// (Learn's lives in the map's older top-level fields; see plugins/learn).

import type { ActionResult } from "../shared/model.ts";
import type { Ctx } from "./actions/context.ts";
import type { Raw, StoredMap } from "./core/types.ts";

export type ServerPlugin = {
  // also the map's purpose, e.g. "design"
  id: string;
  label: string;
  // what the canvas is called to the model (default: "<label> canvas")
  canvasName?: string;
  // other modes a map of this one may switch to and back, keeping the map
  switchesWith?: string[];
  // the model's job on this canvas, sent on every move (with core's map ops)
  prompt: string;
  // extra instructions by name, sent only on moves that list them in `sections`
  sections?: Record<string, string>;
  // the job and sections for one map, when they depend on it (Learn's older
  // maps keep their topic-diagram prompt; its build maps get another)
  promptFor?: (map: StoredMap) => {
    prompt: string;
    sections?: Record<string, string>;
  };
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
  // the model may not change or remove a node you made, chose or settled
  // (by: "you"), whatever its reply says
  keepUserNodes?: boolean;
  // the first move on a new map of this purpose
  start: (ctx: Ctx) => Promise<ActionResult>;
  // a map switched into this mode from another (see switchesWith), once its
  // purpose is set: e.g. Learn lays out a path on a map that has none
  enter?: (ctx: Ctx, from: string) => Promise<ActionResult> | ActionResult;
  // actions the browser sends as {type: "plugin", plugin: id, name, args}
  actions?: Record<
    string,
    (ctx: Ctx, args: Raw) => Promise<ActionResult> | ActionResult
  >;
  // the core actions its screen sends (e.g. a deep dive's thread and hints);
  // any other core action is refused on its maps
  core: readonly string[];
  // the state the browser may see; leave out anything the user should work out
  view?: (map: StoredMap) => unknown;
  // one line for the maps list, e.g. "7 parts · 6 wires"
  summary?: (map: StoredMap) => string;
  // how much of the map waits for review now, and when the next falls due
  // (Learn's spaced rebuilds), for the start screen and the maps list
  due?: (map: StoredMap, now: number) => { now: number; next: number | null };
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
