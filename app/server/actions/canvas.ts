// Acting on nodes: choosing, setting aside, opening a diagram part, side
// threads, and the moves that ask the model to change a node.

import { withDetail, type Ctx } from "./context.ts";
import type { ActionResult } from "../../shared/model.ts";
import { choose as chooseOption } from "../core/canvas.ts";

const done = (ctx: Ctx): ActionResult => {
  ctx.engine.push();
  return {};
};

export function choose(ctx: Ctx, nodeId: string): ActionResult {
  const found = ctx.node(nodeId);
  if (!found || found.node.kind !== "option")
    return { error: "Only an option can be chosen." };
  const q = chooseOption(ctx.map.nodes, nodeId);
  ctx.note(
    `Chose "${found.node.title}"${q ? ` for "${q.title}"` : ""}; the other options under it are set aside.`,
  );
  ctx.map.chat.push({
    role: "you",
    text: `Chose ${found.node.title}`,
    ts: Date.now(),
  });
  return done(ctx);
}

export function drop(ctx: Ctx, nodeId: string): ActionResult {
  const node = ctx.map.nodes[nodeId];
  if (!node) return { error: "No such node." };
  const wasChosen = node.kind === "option" && node.status === "chosen";
  if (node.kind === "option") node.status = "dropped";
  node.dropped = true;
  // setting aside your choice leaves its question open again
  const q = node.parent ? ctx.map.nodes[node.parent] : undefined;
  if (wasChosen && q?.kind === "question" && !q.revealed) q.status = "open";
  node.by = "you";
  ctx.note(`Set aside "${node.title}"; do not raise it again unless asked.`);
  return done(ctx);
}

export function restore(ctx: Ctx, nodeId: string): ActionResult {
  const node = ctx.map.nodes[nodeId];
  if (!node) return { error: "No such node." };
  delete node.dropped;
  if (node.kind === "option") node.status = "proposed";
  if (node.kind === "question" && !node.revealed) node.status = "open";
  ctx.note(`Restored "${node.title}".`);
  return done(ctx);
}

// A part of the topic diagram you clicked becomes a node you can open, explain,
// go deeper on and talk about, listed under what you looked into.
export function focus(ctx: Ctx, anchor: string, label: string): ActionResult {
  const a = String(anchor ?? "").slice(0, 60);
  if (!a) return { error: "Nothing to open." };
  const nodes = ctx.map.nodes;
  const found = Object.values(nodes).find((n) => n.anchor === a);
  if (found) return { nodeId: found.id };
  const root = Object.values(nodes).find((n) => !n.parent);
  const slug = a
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  let id = `el-${slug || "part"}`;
  for (let n = 2; nodes[id]; n++) id = `el-${slug || "part"}-${n}`;
  nodes[id] = {
    id,
    parent: root?.id ?? null,
    kind: "fact",
    title: String(label || a).slice(0, 80),
    summary: "",
    detail: "",
    status: "info",
    by: "you",
    updatedAt: Date.now(),
    order: Object.keys(nodes).length,
    anchor: a,
  };
  ctx.engine.push();
  return { nodeId: id };
}

export function fork(ctx: Ctx, nodeId: string): ActionResult {
  if (!ctx.map.nodes[nodeId]) return { error: "No such node." };
  const threadId = ctx.engine.openThread(ctx.map, nodeId);
  ctx.engine.push();
  return { threadId };
}

// A message in a side thread pinned to a node (opens one if needed).
export async function thread(
  ctx: Ctx,
  nodeId: string,
  threadId: string | undefined,
  text: string,
): Promise<ActionResult> {
  const found = ctx.node(nodeId);
  if (!found) return { error: "No such node." };
  const tid =
    threadId && ctx.map.threads[threadId]
      ? threadId
      : ctx.engine.openThread(ctx.map, nodeId);
  ctx.say(String(text ?? ""), tid);
  const r = await ctx.engine.turn(
    ctx.map.purpose === "learn" && found.node.kind === "question"
      ? `the learner wrote in the thread on step ${found.named}. If it is an answer to the step, judge it; otherwise answer their question about this step.`
      : `the user wrote in the thread on ${found.named}.`,
    ctx.settings,
    { text, threadId: tid, label: "Replying in the thread", view: "thread" },
  );
  return { ...r, threadId: tid };
}

const EXPLAINING = "Writing the explanation";

// Explanations are written only when a node is opened, and never twice.
export function explain(
  ctx: Ctx,
  nodeId: string,
): Promise<ActionResult> | ActionResult {
  const found = ctx.node(nodeId);
  if (!found) return { error: "No such node." };
  if (found.node.detail || ctx.engine.isQueuedOrRunning(nodeId, EXPLAINING))
    return {};
  const part = found.node.anchor
    ? " (a part of the topic diagram the learner clicked: say what it is, what it does in THIS diagram, and what it receives and returns there)"
    : "";
  return withDetail(
    ctx,
    nodeId,
    `EXPLAIN ${found.named}${part}: write its detail. Required: an update op on "${nodeId}" with a "detail" field.`,
    { label: EXPLAINING, nodeId },
  );
}

export function deeper(ctx: Ctx, nodeId: string): Promise<ActionResult> {
  const found = ctx.node(nodeId);
  ctx.say(`Go deeper: ${found?.node.title}`);
  return ctx.engine.turn(`go deeper on ${found?.named}.`, ctx.settings, {
    label:
      ctx.map.purpose === "learn"
        ? "Breaking it into smaller steps"
        : "Going deeper",
    nodeId,
  });
}

export function challenge(ctx: Ctx, nodeId: string): Promise<ActionResult> {
  const found = ctx.node(nodeId);
  ctx.say(`Challenge: ${found?.node.title}`);
  return ctx.engine.turn(
    `challenge ${found?.named}: does it still hold?`,
    ctx.settings,
    { label: "Re-checking it", nodeId },
  );
}

export function next(ctx: Ctx): Promise<ActionResult> {
  ctx.say("Next");
  return ctx.engine.turn(
    ctx.map.purpose === "learn"
      ? "next: point the learner at the next open step and make its first move clear, without solving it."
      : "next: take the most important open question and make it clearer or decidable, or if nothing is open, say what is settled and what remains.",
    ctx.settings,
    { label: "Working out the next step" },
  );
}

export function message(
  ctx: Ctx,
  text: string,
  selection: string[],
): Promise<ActionResult> {
  ctx.say(String(text ?? ""));
  return ctx.engine.turn(
    "the user typed in the main conversation (selected nodes, if any, are its context).",
    ctx.settings,
    {
      text,
      selection,
      label: "Answering",
    },
  );
}
