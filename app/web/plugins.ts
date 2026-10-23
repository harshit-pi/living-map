// The plugins this copy of Living Map has, in the order they are offered.
// Adding one is a line here and one in server/plugins.ts.

import type { WebPlugin } from "./plugin.ts";
import { chatWeb } from "../plugins/chat/web/index.ts";
import { designWeb } from "../plugins/design/web/index.ts";
import { exploreWeb } from "../plugins/explore/web/index.ts";
import { learnWeb } from "../plugins/learn/web/index.ts";

export const PLUGINS: readonly WebPlugin[] = [
  exploreWeb,
  learnWeb,
  designWeb,
  chatWeb,
];

export const pluginFor = (purpose: string): WebPlugin | undefined =>
  PLUGINS.find((p) => p.id === purpose);

// the mode that shows an open map: one whose mode is not installed here is
// shown as Learn, as the server serves it (server/plugins.ts)
export const modeOf = (purpose: string): WebPlugin =>
  pluginFor(purpose) ?? learnWeb;
