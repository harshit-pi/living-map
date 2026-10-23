// Features still being tried out, off unless you turn them on: the
// conversation layer (following a Claude Code chat, the rail and strip, the
// inbox to the chat, views updating themselves) is one of them until it
// passes its gates. On with LIVING_MAP_EXPERIMENTAL=1, or {"experimental":
// true} in ~/.living-map/settings.json.

import fs from "node:fs";
import path from "node:path";

import { HOME } from "./config.ts";

let cached: { at: number; on: boolean } | null = null;

export function experimental(): boolean {
  if (process.env.LIVING_MAP_EXPERIMENTAL)
    return process.env.LIVING_MAP_EXPERIMENTAL === "1";
  // read at most every few seconds: it is asked on every tick and request
  if (cached && Date.now() - cached.at < 5000) return cached.on;
  let on: boolean;
  try {
    const s = JSON.parse(
      fs.readFileSync(path.join(HOME, "settings.json"), "utf8"),
    ) as { experimental?: unknown };
    on = s.experimental === true;
  } catch {
    on = false;
  }
  cached = { at: Date.now(), on };
  return on;
}
