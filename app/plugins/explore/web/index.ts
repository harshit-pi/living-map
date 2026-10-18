// Explore in the browser: how it is offered on the start screen, its header
// controls and its screen.

import { ExploreScreen } from "./ExploreScreen.tsx";
import { ExploreHeader } from "./Header.tsx";
import type { WebPlugin } from "../../../web/plugin.ts";

export const exploreWeb: WebPlugin = {
  id: "explore",
  label: "Explore",
  order: 10,
  switchesWith: ["learn"],
  heading: "What are you deciding or figuring out?",
  blurb: "Claude lays out your options against what you want.",
  placeholder: "A choice, or a why question…",
  examples: [
    "Should I learn Spanish or Mandarin first?",
    "Why do my houseplants keep dying?",
  ],
  // one filled button per screen: Start, then Next on the board
  simple: true,
  Screen: ExploreScreen,
  Header: ExploreHeader,
};
