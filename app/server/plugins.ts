// The plugins this copy of Living Map has, in the order they are offered.
// Adding one is a line here and one in web/plugins.ts.

import type { ServerPlugin } from "./plugin.ts";
import { design } from "../plugins/design/server.ts";
import { explore } from "../plugins/explore/server.ts";

export const PLUGINS: readonly ServerPlugin[] = [explore, design];

export const pluginFor = (purpose: string): ServerPlugin | undefined =>
  PLUGINS.find((p) => p.id === purpose);
