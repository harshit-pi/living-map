// Starting, reopening and switching maps.

import type { ActionResult, Purpose, Settings } from "../../shared/model.ts";
import { splitStart, startAction } from "../core/start.ts";
import type { Engine } from "../engine.ts";
import { newMap, readMap } from "../store.ts";
import type { Ctx } from "./context.ts";

// A new map always starts, even if the model was mid-move on the old one.
export async function start(
  engine: Engine,
  settings: Settings,
  text: string,
  purpose: Purpose,
): Promise<ActionResult> {
  await engine.stop();
  const p: Purpose = purpose === "learn" ? "learn" : "explore";
  const { title, source } = splitStart(text);
  const m = newMap(title, p);
  if (source) m.source = source;
  m.chat.push({ role: "you", text: source || title, ts: Date.now() });
  engine.state.map = m;
  engine.push();
  return engine.turn(startAction(p, m.title), settings, {
    label:
      p === "learn"
        ? "Drawing the topic and your path"
        : "Laying out the options",
  });
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
  map.purpose = purpose === "learn" ? "learn" : "explore";
  ctx.note(`Switched the canvas to ${map.purpose} mode.`);
  engine.push();
  if (map.purpose === "learn" && !map.diagram && !engine.state.busy)
    return engine.turn(
      "the canvas was switched to LEARN mode. Keep the root; under it make 3-5 step questions in learning order (keep useful existing nodes, set the rest aside by removing them only if they are options), and build the TOPIC DIAGRAM with 2-3 blanks. Write the diagram op first.",
      ctx.settings,
      { label: "Turning this into a learning path" },
    );
  return {};
}
