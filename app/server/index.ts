// Living Map server: keeps the canvas (map, threads, topic diagram, scenes),
// turns clicks and typing into model moves, applies the model's changes as
// they stream, and pushes everything to the browser.
//
//   browser ──POST /api/action──► actions ──► engine ──► provider (Claude Code by default)
//      ▲                                         │
//      └──────────── GET /api/events ◄───────────┘  (server-sent events)
//
// Run with Node 23.6+ (types are stripped natively): node server/index.ts

import { HOME, MODEL_CWD, PORT, PROVIDER } from "./config.ts";
import { createEngine } from "./engine.ts";
import { createHub } from "./events.ts";
import { createApp } from "./http.ts";
import { pickProvider } from "./providers/index.ts";
import { loadCurrent, saveMap } from "./store.ts";
import { installSkill } from "../skill/install.ts";

const provider = pickProvider(PROVIDER, { home: HOME, cwd: MODEL_CWD });
const hub = createHub();
const engine = createEngine({
  provider,
  hub,
  initial: loadCurrent(),
  save: saveMap,
});

// the living-map skill, if you installed it, follows this copy of the app
try {
  installSkill(PORT);
} catch (e) {
  console.error("[skill] could not refresh the living-map skill:", e);
}

createApp(engine, hub).listen(PORT, "127.0.0.1", () =>
  console.log(
    `Living Map on http://localhost:${PORT}  (${provider.name}, working in ${MODEL_CWD})`,
  ),
);
