import type { Dispatch, SetStateAction } from "react";

import type { Live } from "./live.ts";
import type {
  Action,
  ActionResult,
  MapDoc,
  Settings,
} from "../../shared/model.ts";

// What every screen works with: the live map, the model settings, how to act,
// and which nodes are selected.
export type Workspace = {
  live: Live;
  map: MapDoc;
  settings: Settings;
  onSettings: (s: Partial<Settings>) => void;
  // sends an action and shows its error, if any, in the banner
  run: (a: Action) => Promise<ActionResult>;
  stop: () => void;
  selection: string[];
  setSelection: Dispatch<SetStateAction<string[]>>;
  // wide enough for the side panel to sit beside the work instead of over it
  roomy: boolean;
};
