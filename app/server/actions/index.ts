// Every action the browser can send, routed to the module that handles it.

import { safeId } from "../core/types.ts";
import type { Engine } from "../engine.ts";
import * as canvas from "./canvas.ts";
import { makeCtx } from "./context.ts";
import * as learn from "./learn.ts";
import * as maps from "./maps.ts";
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

  switch (req.type) {
    case "purpose":
      return maps.switchPurpose(ctx, req.purpose);
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
      return canvas.message(
        ctx,
        req.text,
        Array.isArray(req.selection)
          ? req.selection.filter((id) => typeof id === "string" && safeId(id))
          : [],
      );
    case "fill":
      return learn.fill(ctx, req.blankId, req.text);
    case "hint":
      return learn.hint(ctx, req.nodeId);
    case "answer":
      return learn.answer(ctx, req.nodeId, req.threadId);
    case "scene":
      return learn.buildScene(ctx, req.nodeId);
    case "play":
      return learn.play(ctx, req.nodeId, req.key);
    case "playshow":
      return learn.show(ctx, req.nodeId);
    case "replay":
      return learn.replay(ctx, req.nodeId);
    default:
      return { error: `Unknown action ${(req as { type?: string }).type}` };
  }
}
