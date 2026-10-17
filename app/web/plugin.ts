// The contract a plugin implements in the browser: how it is offered on the
// start screen, and the screen that shows its maps. Its state arrives in
// map.data[plugin.id], as the plugin's server chose to show it.

import type { ReactElement } from "react";

import type { Workspace } from "./lib/workspace.ts";

export type WebPlugin = {
  id: string;
  label: string;
  // its place among the modes on the start screen (Learn, built in, is 20)
  order?: number;
  // other modes a map of this one may switch to and back (the header offers them)
  switchesWith?: string[];
  // the start screen, while this mode is picked
  heading: string;
  blurb: string;
  placeholder: string;
  examples: string[];
  Screen: (props: { ws: Workspace }) => ReactElement;
  // controls this mode adds to the header (Explore's Set aside and Next)
  Header?: (props: { ws: Workspace }) => ReactElement;
};
