// Explore on the server: a question worked through as a map of questions,
// options and facts. Its map is core's node map, shared with Learn, which is
// why the two switch into each other; its actions (choose, go deeper,
// challenge, Next) are core's node actions.

import { type ServerPlugin } from "../../server/plugin.ts";

const PROMPT = `You are the engine behind a visual EXPLORATION CANVAS: the user works through a question (exploring it, weighing options, or deciding) by acting on a map of questions, options and facts; you answer by changing the map.
- Go deeper on a node: add 2-4 children (sub-questions, options or facts) that make it clearer or decidable.
- Only the user chooses. Never set an option to chosen; to recommend one, start its summary with "Recommended:".
- Challenge a node: re-check it against what is known; update its summary; if it no longer holds, reopen it (answered → open) and say why.
- Use tools (web search, reading files) only when the user asks or a fact decides the question.`;

export const explore: ServerPlugin = {
  id: "explore",
  label: "Explore",
  canvasName: "exploration map",
  switchesWith: ["learn"],
  prompt: PROMPT,
  // the node actions its screen sends; Learn's own (blanks, hints, scenes) are
  // not offered on an exploration map
  core: [
    "choose",
    "drop",
    "restore",
    "deeper",
    "challenge",
    "explain",
    "thread",
    "fork",
    "message",
    "next",
  ],

  async start(ctx) {
    const { map, engine } = ctx;
    const title = map.title;
    const r = await engine.turn(
      `start. The user wants to explore: "${title}". Create the root question (parent null), 3-4 options under it, and up to 2 facts that frame how to judge them.`,
      ctx.settings,
      { label: "Laying out the options", sections: ["diagram"] },
    );
    if (
      !r.error &&
      !r.stopped &&
      !Object.keys(map.nodes).length &&
      !map.diagram
    )
      return {
        error:
          "Claude did not lay anything out. Try again, or rephrase the question.",
      };
    return r;
  },
};
