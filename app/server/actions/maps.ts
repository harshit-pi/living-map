// Starting, reopening and switching maps.

import type { ActionResult, Purpose, Settings } from "../../shared/model.ts";
import { splitStart, startAction } from "../core/start.ts";
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
  const plugin = pluginFor(purpose);
  const p: Purpose = plugin
    ? plugin.id
    : purpose === "learn"
      ? "learn"
      : "explore";
  const { title, source } = splitStart(text);
  const m = newMap(title, p);
  if (source) m.source = source;
  m.chat.push({ role: "you", text: source || title, ts: Date.now() });
  engine.state.map = m;
  engine.push();
  if (plugin) return plugin.start(makeCtx(engine, settings, m));
  const r = await engine.turn(startAction(p, m.title), settings, {
    label:
      p === "learn"
        ? "Drawing the topic and your path"
        : "Laying out the options",
    sections: ["diagram"],
  });
  if (!r.error && !r.stopped && !Object.keys(m.nodes).length && !m.diagram)
    return {
      error:
        "Claude did not lay anything out. Try again, or rephrase the question.",
    };
  return r;
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

// Switch between Explore and Learn. A map with no topic diagram gets one.
export function switchPurpose(
  ctx: Ctx,
  purpose: Purpose,
): Promise<ActionResult> | ActionResult {
  const { map, engine } = ctx;
  if (pluginFor(map.purpose))
    return {
      error: "This map's mode is fixed; start a new map for another mode.",
    };
  // a plugin's mode is set only when its map is started
  if (purpose !== "learn" && purpose !== "explore")
    return { error: "A map switches only between Explore and Learn." };
  if (map.purpose === purpose) return {};
  map.purpose = purpose;
  ctx.note(`Switched the canvas to ${map.purpose} mode.`);
  engine.push();
  if (map.purpose === "learn" && !map.diagram && !engine.state.busy)
    return engine.turn(
      "the canvas was switched to LEARN mode. Keep the root; under it make 3-5 step questions in learning order (keep useful existing nodes, set the rest aside by removing them only if they are options), and build the TOPIC DIAGRAM with 2-3 blanks. Write the diagram op first.",
      ctx.settings,
      { label: "Turning this into a learning path", sections: ["diagram"] },
    );
  return {};
}
