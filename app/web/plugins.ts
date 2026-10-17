// The plugins this copy of Living Map has, in the order they are offered.
// Adding one is a line here and one in server/plugins.ts.

import type { WebPlugin } from "./plugin.ts";
import { designWeb } from "../plugins/design/web/index.ts";

export const PLUGINS: readonly WebPlugin[] = [designWeb];

export const pluginFor = (purpose: string): WebPlugin | undefined =>
  PLUGINS.find((p) => p.id === purpose);
