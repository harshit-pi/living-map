// Learn in the browser: how it is offered on the start screen, and its screen
// (the path, the topic diagram, and steps played by hand).

import { LearnScreen } from "./LearnScreen.tsx";
import type { WebPlugin } from "../../../web/plugin.ts";

export const learnWeb: WebPlugin = {
  id: "learn",
  label: "Learn",
  order: 20,
  switchesWith: ["explore"],
  heading: "What do you want to understand?",
  blurb:
    "Any subject. Claude draws it in the shape that fits and leaves the key parts blank for you to fill.",
  placeholder:
    "e.g. a protocol, a theory, a period of history, a coding problem",
  examples: [
    "How TCP opens a connection",
    "What drives an option price (Black–Scholes)?",
    "Why did World War I start?",
    "LeetCode 146: LRU Cache",
  ],
  badge: "success",
  Screen: LearnScreen,
};
