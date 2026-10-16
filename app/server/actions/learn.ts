// Learning: blanks on the topic diagram, the hint ladder, shown answers, and
// playable scenes (checked here, with no model call).

import { hintCount, withDetail, type Ctx } from "./context.ts";
import type { ActionResult, MapNode } from "../../shared/model.ts";
import { newPlay, playMove, showMove } from "../core/scene.ts";
import type { Play } from "../core/types.ts";

export function fill(
  ctx: Ctx,
  blankId: string,
  text: string,
): Promise<ActionResult> | ActionResult {
  if (!blankId) return { error: "No blank." };
  ctx.map.fills[blankId] = {
    text: String(text ?? "").slice(0, 200),
    state: "pending",
  };
  ctx.map.chat.push({
    role: "you",
    text: `Filled a blank: ${text}`,
    ts: Date.now(),
  });
  ctx.engine.push();
  return ctx.engine.turn(
    `FILL: the learner wrote "${text}" in blank ${blankId} on the topic diagram. Judge it with a judge op.`,
    ctx.settings,
    {
      label: "Checking your answer",
      sections: ["diagram"],
      blankId,
    },
  );
}

export function hint(ctx: Ctx, nodeId: string): Promise<ActionResult> {
  const found = ctx.node(nodeId);
  ctx.say(`Hint: ${found?.node.title}`);
  const count = hintCount(ctx.map, nodeId);
  const scene = ctx.map.scenes[nodeId];
  if (scene && (ctx.map.play[nodeId]?.at ?? 0) < scene.moves.length)
    return ctx.engine.turn(
      `HINT on the scene for step ${found?.named}: the learner is stuck on its current move. Add a fact under the step titled "Hint ${count + 1}" with one pointed question about THIS move (use their wrong tries), never the answer.`,
      ctx.settings,
      { label: "Finding a hint for this move", nodeId },
    );
  return ctx.engine.turn(
    `HINT on step ${found?.named}: the next rung of the ladder (it has ${count} hint(s) so far).`,
    ctx.settings,
    {
      label: "Finding the next hint",
      sections: ["diagram"],
      nodeId,
    },
  );
}

export async function answer(ctx: Ctx, nodeId: string): Promise<ActionResult> {
  const found = ctx.node(nodeId);
  ctx.say(`Show answer: ${found?.node.title}`);
  const r = await withDetail(
    ctx,
    nodeId,
    `SHOW ANSWER on step ${found?.named}. Required: an update op on "${nodeId}" with the full answer in its "detail" field; fill this step's blanks with judge ops (state right, with the label).`,
    { label: "Writing the answer", nodeId, sections: ["diagram"] },
  );
  // a shown answer is not one you earned: never credit it as solved; and only
  // mark it shown once an answer actually arrived
  const node = ctx.map.nodes[nodeId];
  if (!r.error && node?.detail) {
    node.revealed = true;
    ctx.engine.push();
  }
  return r;
}

export function buildScene(
  ctx: Ctx,
  nodeId: string,
): Promise<ActionResult> | ActionResult {
  const found = ctx.node(nodeId);
  if (!found) return { error: "No such step." };
  return ctx.engine.turn(
    `SCENE for step ${found.named}: build a playable scene for this step (op "scene", step "${nodeId}"), on the same tiny example as the diagram where it fits.`,
    ctx.settings,
    { label: "Building a playable scene", nodeId, sections: ["scene"] },
  );
}

// A finished scene counts as worked out by you unless most of it was shown.
function finishScene(ctx: Ctx, node: MapNode, p: Play) {
  const total = ctx.map.scenes[node.id].moves.length;
  if (node.kind === "question" && !node.revealed) {
    if (p.shown * 2 > total) node.revealed = true;
    else node.status = "answered";
  }
  ctx.note(
    `Played the scene on "${node.title}": ${total} moves, ${p.wrong} wrong tries, ${p.shown} shown.`,
  );
}

function advance(
  ctx: Ctx,
  nodeId: string,
  step: (before: Play) => Play,
): ActionResult {
  const scene = ctx.map.scenes[nodeId];
  const node = ctx.map.nodes[nodeId];
  if (!scene || !node) return { error: "No scene on that step." };
  const before = ctx.map.play[nodeId] ?? newPlay();
  const p = step(before);
  ctx.map.play[nodeId] = p;
  if (p.at >= scene.moves.length && before.at < scene.moves.length)
    finishScene(ctx, node, p);
  ctx.engine.push();
  return { ok: p.last?.ok ?? false };
}

// Checked here, instantly, against the answers the model wrote: no model call.
export const play = (ctx: Ctx, nodeId: string, key: string) =>
  advance(ctx, nodeId, (before) =>
    playMove(ctx.map.scenes[nodeId], before, String(key ?? "")),
  );

export const show = (ctx: Ctx, nodeId: string) =>
  advance(ctx, nodeId, (before) => showMove(ctx.map.scenes[nodeId], before));

export function replay(ctx: Ctx, nodeId: string): ActionResult {
  if (!ctx.map.scenes[nodeId]) return { error: "No scene on that step." };
  ctx.map.play[nodeId] = newPlay();
  ctx.engine.push();
  return {};
}
