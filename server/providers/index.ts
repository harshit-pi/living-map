// Which model the map talks to. Set LIVING_MAP_PROVIDER to pick another
// once one is added; Claude Code is the default.

import { claudeCode } from "./claude-code.ts";
import type { ModelProvider } from "./types.ts";

const PROVIDERS: Record<string, (opts: { home: string }) => ModelProvider> = {
  "claude-code": claudeCode,
};

export function pickProvider(
  name: string | undefined,
  opts: { home: string },
): ModelProvider {
  const make = PROVIDERS[name || "claude-code"];
  if (!make)
    throw new Error(
      `Unknown LIVING_MAP_PROVIDER "${name}". Known: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  return make(opts);
}

export type { ModelProvider } from "./types.ts";
