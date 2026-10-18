// The contract a plugin implements in the browser: how it is offered on the
// start screen, how its maps are listed, and the screen that shows them. Its state arrives in
// map.data[plugin.id], as the plugin's server chose to show it.

import type { ReactElement } from "react";

import type { Action } from "../shared/model.ts";
import type { Workspace } from "./lib/workspace.ts";

export type WebPlugin = {
  id: string;
  label: string;
  // its place among the modes on the start screen (Explore 10, Learn 20)
  order?: number;
  // other modes a map of this one may switch to and back (the header offers them)
  switchesWith?: string[];
  // the start screen, while this mode is picked
  heading: string;
  blurb: string;
  placeholder: string;
  examples: string[];
  // the tone of its tag in the maps list (default: warning)
  badge?: "success" | "warning";
  Screen: (props: { ws: Workspace }) => ReactElement;
  // controls this mode adds to the header (Explore's Set aside and Next)
  Header?: (props: { ws: Workspace }) => ReactElement;
  // the simpler chrome (one filled button per screen): the start screen's
  // Start button and filled mode switch, New inside Maps, the short working
  // pill. Off, a mode keeps the chrome it has (Design).
  simple?: boolean;
  // a question the loading screen asks while this mode's new map is laid
  // out: the answer is held, and sent once the map exists, so the first
  // choice never waits for Claude (Learn's "How much do you know?")
  Waiting?: (props: {
    held: Action | null;
    hold: (a: Action) => void;
  }) => ReactElement;
};
