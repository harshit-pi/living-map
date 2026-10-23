// Chat in the browser: how it is offered on the start screen, its header
// controls and its screen.

import { ChatScreen } from "./ChatScreen.tsx";
import { ChatHeader } from "./Header.tsx";
import type { WebPlugin } from "../../../web/plugin.ts";
import { PLUGIN_ID } from "../shared.ts";

export const chatWeb: WebPlugin = {
  id: PLUGIN_ID,
  label: "Chat",
  order: 5,
  heading: "Map a conversation you are having in Claude Code",
  blurb:
    "Open it from the conversation itself: say /living-map there. The map follows it as it goes (its topics, what is still to do, what was decided) and you can start side chats from any part of it.",
  placeholder: "Say /living-map in a Claude Code conversation",
  examples: [],
  badge: "success",
  simple: true,
  Screen: ChatScreen,
  Header: ChatHeader,
};
