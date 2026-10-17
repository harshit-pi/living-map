// Help on a step: the hint ladder, and the answer shown when you ask for it.
// Learn's steps and Design's deep dives both use them.

import { hintCount, withDetail, type Ctx } from "./context.ts";
import { ASK_ANSWER, type ActionResult } from "../../shared/model.ts";
import { own } from "../core/types.ts";

export function hint(
  ctx: Ctx,
  nodeId: string,
): Promise<ActionResult> | ActionResult {
  const found = ctx.node(nodeId);
  // a hint is on a step or a deep dive, never the map's own question
  if (!found || !found.node.parent) return { error: "No such step." };
  ctx.say(`Hint: ${found.node.title}`);
  const count = hintCount(ctx.map, nodeId);
  const scene = ctx.map.scenes[nodeId];
  if (scene && (ctx.map.play[nodeId]?.at ?? 0) < scene.moves.length)
    return ctx.engine.turn(
      `HINT on the scene for step ${found.named}: the learner is stuck on its current move. Add a fact under the step titled "Hint ${count + 1}" with one pointed question about THIS move (use their wrong tries), never the answer.`,
      ctx.settings,
      { label: "Finding a hint for this move", nodeId },
    );
  return ctx.engine.turn(
    `HINT on step ${found.named}: the next rung of the ladder (it has ${count} hint(s) so far).`,
    ctx.settings,
    {
      label: "Finding the next hint",
      sections: ["diagram"],
      nodeId,
    },
  );
}

// The answer is written in the step's thread, where you were working on it.
export async function answer(
  ctx: Ctx,
  nodeId: string,
  threadId?: string,
): Promise<ActionResult> {
  const found = ctx.node(nodeId);
  if (!found) return { error: "No such node." };
  const given = threadId ? own(ctx.map.threads, threadId) : undefined;
  const tid =
    given?.nodeId === nodeId
      ? given.id
      : (Object.values(ctx.map.threads)
          .filter((t) => t.nodeId === nodeId)
          .sort((a, b) => a.createdAt - b.createdAt)
          .at(-1)?.id ?? ctx.engine.openThread(ctx.map, nodeId));
  ctx.say(ASK_ANSWER, tid);
  const r = await withDetail(
    ctx,
    nodeId,
    `SHOW ANSWER on step ${found.named}, asked in its thread. Reply with the answer, worked through for this example. Required: an update op on "${nodeId}" with the full answer in its "detail" field; fill this step's blanks with judge ops (state right, with the label).`,
    {
      label: "Writing the answer",
      nodeId,
      threadId: tid,
      view: "thread",
      sections: ["diagram", "threads"],
      judge: true,
    },
  );
  // a shown answer is not one you earned: never credit it as solved; and only
  // mark it shown once an answer actually arrived
  const node = ctx.map.nodes[nodeId];
  if (!r.error && node?.detail) {
    node.revealed = true;
    ctx.engine.push();
  }
  return { ...r, threadId: tid };
}
