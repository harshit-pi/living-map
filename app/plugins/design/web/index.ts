// Design in the browser: how it is offered on the start screen, and its screen.

import type { WebPlugin } from "../../../web/plugin.ts";
import { PLUGIN_ID } from "../shared.ts";
import { DesignScreen } from "./DesignScreen.tsx";

export const designWeb: WebPlugin = {
  id: PLUGIN_ID,
  label: "Design",
  heading: "What system do you want to design?",
  blurb:
    "The way a system-design book teaches it: the requirements and scale, then a high-level design you build from components, then the deep dives. A rough load check runs as you wire it, and Claude reviews it against a reference it keeps to itself.",
  placeholder: "e.g. Twitter, a URL shortener, a chat app",
  examples: [
    "Design Twitter",
    "Design a URL shortener",
    "Design WhatsApp",
    "Design YouTube",
  ],
  Screen: DesignScreen,
};
