// "Show me the answer" on a build map. A learner who still cannot do it gets
// the answer, in the form the question asks for (code for a coding problem,
// a worked explanation for a concept), written into the thread of the step
// it is for, or of the whole question. A shown answer is never credit: a
// step built after it counts as shown, and comes back for review as one.

import { at, err, fail, id, ok, state, type Act } from "./build.ts";
import type { Ctx } from "../../server/actions/context.ts";
import { own } from "../../server/core/types.ts";
import { ASK_ANSWER, type ActionResult } from "../../shared/model.ts";

export const ASK_FULL = "Show me the full answer.";
const WRITING = "Writing the answer";

const FORM =
  "Give the answer in the form the question asks for: for a coding problem, the complete code in a fenced block, then one line on how it works and its time and space; for anything else, the answer worked through on this case, in a few short lines.";

// The thread to answer in: the one the learner asked from, else the node's
// latest, else a new one.
function threadFor(ctx: Ctx, nodeId: string, asked: unknown): string {
  const given = own(ctx.map.threads, id(asked));
  if (given?.nodeId === nodeId) return given.id;
  return (
    Object.values(ctx.map.threads)
      .filter((t) => t.nodeId === nodeId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .at(-1)?.id ?? ctx.engine.openThread(ctx.map, nodeId)
  );
}

// One move into the thread; the answer is also kept as the node's detail,
// so it stays on the map. One second try if the detail did not arrive.
async function write(
  ctx: Ctx,
  nodeId: string,
  threadId: string,
  ask: string,
  action: string,
): Promise<ActionResult> {
  if (ctx.engine.isQueuedOrRunning(nodeId, WRITING)) return {};
  const before = ctx.map.nodes[nodeId]?.detail;
  ctx.say(ask, threadId);
  const opts = { label: WRITING, nodeId, threadId, view: "thread" as const };
  let r = await ctx.engine.turn(action, ctx.settings, opts);
  const arrived = () => {
    const d = own(ctx.map.nodes, nodeId)?.detail;
    return !!d && d !== before;
  };
  if (!r.error && !r.stopped && !arrived())
    r = await ctx.engine.turn(
      `${action} Your previous reply did not deliver it: send the map block again as valid JSON, with the update op on "${nodeId}" carrying the "detail".`,
      ctx.settings,
      { ...opts, label: `${WRITING} (second try)` },
    );
  if (r.error || r.stopped) return r;
  if (!arrived()) return { ...r, error: "Claude did not write it. Try again." };
  return { ...r, threadId };
}

// A step's answer: only after a first try (a Check, or a Why sent).
export const answerStep: Act = async (ctx, a) => {
  const x = at(ctx, a);
  if (fail(x)) return err(x);
  const tried =
    (x.s.builds[x.m.id]?.checks ?? 0) > 0 ||
    (x.st.why?.tries ?? 0) > 0 ||
    x.st.stage === "built";
  if (!tried) return err("Try it once first: build what you can, then Check.");
  const node = ctx.map.nodes[x.step];
  const r = await write(
    ctx,
    x.step,
    threadFor(ctx, x.step, a?.threadId),
    ASK_ANSWER,
    `SHOW ANSWER on step [${x.step}] "${node.title}": the learner tried and asked to be shown. Answer this step's question fully, on its case: you may name its parts and links now. ${FORM} Required: an update op on "${x.step}" with the full answer in its "detail" field.`,
  );
  if (r.error || !r.threadId) return r;
  // shown, never earned: a build after this is credited as shown
  x.st.viaModel = true;
  node.revealed = true;
  return { ...ok(ctx), threadId: r.threadId };
};

// The whole question's answer, any time: it marks no step built.
export const fullAnswer: Act = async (ctx, a) => {
  if (!state(ctx.map)) return err("This map is not practised as builds.");
  const root = Object.values(ctx.map.nodes).find((n) => !n.parent);
  if (!root) return err("No question on this map yet.");
  const r = await write(
    ctx,
    root.id,
    threadFor(ctx, root.id, a?.threadId),
    ASK_FULL,
    `FULL ANSWER to the map's question "${root.title}": the learner asked for the whole answer. ${FORM} Required: an update op on "${root.id}" with the full answer in its "detail" field; change nothing else.`,
  );
  if (r.error || !r.threadId) return r;
  return { ...ok(ctx), threadId: r.threadId };
};
