// Starting, reopening and switching maps.

import type { ActionResult, Purpose, Settings } from "../../shared/model.ts";
import { splitStart } from "../core/start.ts";
import type { Engine } from "../engine.ts";
import { pluginFor } from "../plugins.ts";
import { newMap, readMap } from "../store.ts";
import { makeCtx, type Ctx } from "./context.ts";

// A new map always starts, even if the model was mid-move on the old one.
export async function start(
  engine: Engine,
  settings: Settings,
  text: string,
  purpose: Purpose,
): Promise<ActionResult> {
  await engine.stop();
  // an unknown mode starts as Explore
  const plugin = pluginFor(purpose) ?? pluginFor("explore")!;
  const { title, source } = splitStart(text);
  const m = newMap(title, plugin.id);
  if (source) m.source = source;
  m.chat.push({ role: "you", text: source || title, ts: Date.now() });
  engine.state.map = m;
  engine.push();
  return plugin.start(makeCtx(engine, settings, m));
}

// Reopen an earlier map; a move still running on the current one is stopped first.
export async function open(
  engine: Engine,
  mapId: string,
): Promise<ActionResult> {
  const m = readMap(String(mapId ?? ""));
  if (!m) return { error: "That map is gone." };
  await engine.stop();
  engine.state.map = m;
  engine.push();
  return {};
}

// Switch between Explore and Learn. Nothing on the map is removed on the way,
// so switching back finds it all; the mode switched to may add to it (Learn
// lays out a path on a map that has none).
export function switchPurpose(
  ctx: Ctx,
  purpose: Purpose,
): Promise<ActionResult> | ActionResult {
  const { map, engine } = ctx;
  if (map.purpose === purpose) return {};
  // two modes switch when one of them names the other (Explore names Learn);
  // any other plugin's mode is set only when its map is started
  const pairs = (a: string, b: string) =>
    !!pluginFor(a)?.switchesWith?.includes(b);
  if (!pairs(map.purpose, purpose) && !pairs(purpose, map.purpose))
    return {
      error:
        pluginFor(map.purpose) && !pluginFor(map.purpose)?.switchesWith?.length
          ? "This map's mode is fixed; start a new map for another mode."
          : "A map switches only between Explore and Learn.",
    };
  // not while a move runs or waits: it would land on the other mode's
  // screen, and the browser keeps the switch off then too
  if (engine.state.busy || engine.state.waiting.length)
    return { error: "Claude is working on this map: switch once it is done." };
  const from = map.purpose;
  map.purpose = purpose;
  ctx.note(`Switched the canvas to ${map.purpose} mode.`);
  // the plugin sets its state up first (Learn's build state, before its
  // first move), so the switched map goes out as the new mode's screen: sent
  // before, Learn showed its old screen until that move's first push
  const r = pluginFor(map.purpose)?.enter?.(ctx, from) ?? {};
  engine.push();
  return r;
}
