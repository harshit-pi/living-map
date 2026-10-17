// Every action the browser can send, routed to the module that handles it.

import { safeId } from "../core/types.ts";
import type { Engine } from "../engine.ts";
import { modeOf } from "../plugins.ts";
import * as canvas from "./canvas.ts";
import { makeCtx } from "./context.ts";
import * as maps from "./maps.ts";
import * as steps from "./steps.ts";
import type {
  ActionRequest,
  ActionResult,
  Settings,
} from "../../shared/model.ts";

// Only model and effort ids the provider offers get through.
function cleanSettings(engine: Engine, raw: Partial<Settings> = {}): Settings {
  const { models, efforts } = engine.provider;
  return {
    model: models.some((m) => m.id === raw.model) ? (raw.model ?? "") : "",
    effort: efforts.some((e) => e.id === raw.effort) ? (raw.effort ?? "") : "",
  };
}

// Ids the browser sends become object keys: only plain, safe ones get through.
function badIds(req: ActionRequest): boolean {
  const r = req as Record<string, unknown>;
  return ["nodeId", "blankId", "threadId", "mapId"].some(
    (k) => r[k] !== undefined && (typeof r[k] !== "string" || !safeId(r[k])),
  );
}

export async function act(
  engine: Engine,
  req: ActionRequest,
): Promise<ActionResult> {
  if (!req || typeof req !== "object" || badIds(req))
    return { error: "That request is not valid." };
  if (typeof req.type !== "string")
    return { error: "That request is not valid." };
  const settings = cleanSettings(engine, req.settings);
  switch (req.type) {
    case "stop":
      await engine.stop();
      return {};
    case "open":
      return maps.open(engine, req.mapId);
    case "new":
      return maps.start(engine, settings, req.text, req.purpose);
  }

  const map = engine.state.map;
  if (!map) return { error: "Start first." };
  const ctx = makeCtx(engine, settings, map);
  // a map takes its mode's own actions and only the core ones its screen uses
  const own = modeOf(map.purpose);
  if (
    req.type !== "plugin" &&
    req.type !== "purpose" &&
    !own.core.includes(req.type)
  )
    return { error: "That action is not available on this map." };
  // the selection names nodes the browser picked: only plain ids get through
  const selection = Array.isArray((req as { selection?: unknown }).selection)
    ? (req as { selection: unknown[] }).selection.filter(
        (id): id is string => typeof id === "string" && safeId(id),
      )
    : [];
  // a plugin may answer a core action its screen uses its own way (Explore's
  // choose records why; its Next picks the gap; Learn's blanks and scenes are
  // its own): it gets the whole request
  if (
    req.type !== "plugin" &&
    req.type !== "purpose" &&
    own.core.includes(req.type) &&
    Object.hasOwn(own.actions ?? {}, req.type)
  )
    return own.actions![req.type](ctx, { ...req, selection });

  switch (req.type) {
    case "purpose":
      return maps.switchPurpose(ctx, req.purpose);
    case "plugin": {
      // only the map's own plugin answers, and only with an action it declares
      const run =
        own.id === req.plugin &&
        typeof req.name === "string" &&
        Object.hasOwn(own.actions ?? {}, req.name)
          ? own.actions![req.name]
          : null;
      if (!run) return { error: "That action is not available on this map." };
      const args = req.args && typeof req.args === "object" ? req.args : {};
      return run(ctx, args as Record<string, unknown>);
    }
    case "choose":
      return canvas.choose(ctx, req.nodeId);
    case "drop":
      return canvas.drop(ctx, req.nodeId);
    case "restore":
      return canvas.restore(ctx, req.nodeId);
    case "focus":
      return canvas.focus(ctx, req.anchor, req.label);
    case "fork":
      return canvas.fork(ctx, req.nodeId);
    case "thread":
      return canvas.thread(ctx, req.nodeId, req.threadId, req.text);
    case "explain":
      return canvas.explain(ctx, req.nodeId);
    case "deeper":
      return canvas.deeper(ctx, req.nodeId);
    case "challenge":
      return canvas.challenge(ctx, req.nodeId);
    case "next":
      return canvas.next(ctx);
    case "message":
      return canvas.message(ctx, req.text, selection);
    case "hint":
      return steps.hint(ctx, req.nodeId);
    case "answer":
      return steps.answer(ctx, req.nodeId, req.threadId);
    default:
      return { error: `Unknown action "${(req as { type: string }).type}".` };
  }
}
