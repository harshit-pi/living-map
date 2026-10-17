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
  heading: "What do you want to think through?",
  blurb:
    "A choice to make or a question to think through. Claude lays out the options against what you want on a board, fills in what it knows and marks its guesses; you rate, choose and settle.",
  placeholder: "e.g. Which database for the new service?",
  examples: [
    "Which learning vertical should Living Map start with?",
    "Postgres or DynamoDB for a new service?",
  ],
  Screen: ExploreScreen,
  Header: ExploreHeader,
};
