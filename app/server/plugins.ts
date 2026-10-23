// The plugins this copy of Living Map has, in the order they are offered.
// Adding one is a line here and one in web/plugins.ts.

import type { StoredMap } from "./core/types.ts";
import type { ServerPlugin } from "./plugin.ts";
import { follow } from "../layer/view.ts";
import { design } from "../plugins/design/server.ts";
import { explore } from "../plugins/explore/server.ts";
import { learn } from "../plugins/learn/server.ts";

export const PLUGINS: readonly ServerPlugin[] = [explore, learn, design];

// What every view of a map may share, beside its mode: the conversation
// layer, on a map linked to one of your conversations. `view` is what the
// browser sees of it (undefined: nothing for this map).
export type Layer = {
  id: string;
  view: (map: StoredMap) => unknown;
  // you wrote on a view (in a node's thread, or its main box) and it answered
  heard?: (
    map: StoredMap,
    move: { said: string; answer: string; on: string | null },
  ) => void;
};
export const LAYERS: readonly Layer[] = [follow];

export const pluginFor = (purpose: string): ServerPlugin | undefined =>
  PLUGINS.find((p) => p.id === purpose);

// The mode that serves an open map. A map whose mode is not installed here
// (saved by a copy with another plugin) is served as Learn: the browser shows
// it on Learn's screen, so the model is told Learn's job and every action
// that screen sends is taken. A new map of an unknown mode starts as Explore
// instead (actions/maps.ts).
export const modeOf = (purpose: string): ServerPlugin =>
  pluginFor(purpose) ?? learn;
