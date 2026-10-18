// Learn in the browser: how it is offered on the start screen, and its screen
// (the path, the topic diagram, and steps played by hand).

import { LearnScreen } from "./LearnScreen.tsx";
import { LevelWaiting } from "./StepTop.tsx";
import type { WebPlugin } from "../../../web/plugin.ts";

export const learnWeb: WebPlugin = {
  id: "learn",
  label: "Learn",
  order: 20,
  switchesWith: ["explore"],
  heading: "What do you want to understand?",
  // the review promise is told when there is something to come back to
  // (the done card): here, "it comes back later" had no "it" yet
  blurb: "Build it yourself, step by step.",
  placeholder: "A topic or a question…",
  examples: ["How TCP opens a connection", "Why did World War I start?"],
  badge: "success",
  simple: true,
  Screen: LearnScreen,
  Waiting: LevelWaiting,
};
