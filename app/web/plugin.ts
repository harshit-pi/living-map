// The contract a plugin implements in the browser: how it is offered on the
// start screen, and the screen that shows its maps. Its state arrives in
// map.data[plugin.id], as the plugin's server chose to show it.

import type { ReactElement } from "react";

import type { Workspace } from "./lib/workspace.ts";

export type WebPlugin = {
  id: string;
  label: string;
  // the start screen, while this mode is picked
  heading: string;
  blurb: string;
  placeholder: string;
  examples: string[];
  Screen: (props: { ws: Workspace }) => ReactElement;
};
