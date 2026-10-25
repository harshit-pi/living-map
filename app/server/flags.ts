// Features still being tried out, off unless you turn them on: the
// conversation layer (following a Claude Code chat, the rail and strip, the
// inbox to the chat, views updating themselves) is one of them until it
// passes its gates. On with LIVING_MAP_EXPERIMENTAL=1, or {"experimental":
// true} in ~/.living-map/settings.json.

import fs from "node:fs";
import path from "node:path";

import { HOME } from "./config.ts";

let cached: { at: number; s: Record<string, unknown> } | null = null;

// ~/.living-map/settings.json, read at most every few seconds: flags are
// asked on every tick and request
function settings(): Record<string, unknown> {
  if (cached && Date.now() - cached.at < 5000) return cached.s;
  let s: Record<string, unknown>;
  try {
    s = JSON.parse(
      fs.readFileSync(path.join(HOME, "settings.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    s = {};
  }
  cached = { at: Date.now(), s };
  return s;
}

const flag = (env: string, key: string) =>
  process.env[env] ? process.env[env] === "1" : settings()[key] === true;

export const experimental = () =>
  flag("LIVING_MAP_EXPERIMENTAL", "experimental");

// The v3 map (app/ledger/): the item store, following the chat, and its
// page. Its own switch, so it can be tried apart from the conversation
// layer above: LIVING_MAP_LEDGER=1, or {"ledger": true} in settings.json.
export const ledger = () => flag("LIVING_MAP_LEDGER", "ledger");

// the chat hears the map (the inbox, the listener) when either is on
export const listening = () => experimental() || ledger();
