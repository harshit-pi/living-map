// Living Map server: keeps the canvas (map, threads, topic diagram, scenes),
// turns clicks and typing into model moves, applies the model's changes as
// they stream, and pushes everything to the browser.
//
//   browser ──POST /api/action──► actions ──► engine ──► provider (Claude Code by default)
//      ▲                                         │
//      └──────────── GET /api/events ◄───────────┘  (server-sent events)
//
// Run with Node 23.6+ (types are stripped natively): node server/index.ts

import { createAuth } from "./auth.ts";
import { HOME, MODEL_CWD, PORT, PROVIDER } from "./config.ts";
import { createEngine } from "./engine.ts";
import { createHub } from "./events.ts";
import { experimental, ledger } from "./flags.ts";
import { createApp } from "./http.ts";
import { ledgerServer } from "./ledger.ts";
import { pickProvider } from "./providers/index.ts";
import { loadCurrent, saveMap } from "./store.ts";
import { follow } from "../layer/follow.ts";
import { refreshView } from "../layer/server.ts";
import { installSkill } from "../skill/install.ts";

const provider = pickProvider(PROVIDER, { home: HOME, cwd: MODEL_CWD });
const hub = createHub();
const engine = createEngine({
  provider,
  hub,
  initial: loadCurrent(),
  save: saveMap,
});

// a map linked to a conversation follows it while it is open (still being
// tried out: see flags.ts)
follow(engine, { refreshView, on: experimental });

// the living-map skill, if you installed it, follows this copy of the app;
// a second copy run beside it (its own home, another port: a test server)
// leaves it alone, so the skill never points at a server about to stop
if (!process.env.LIVING_MAP_HOME || PORT === 4317)
  try {
    installSkill(PORT);
  } catch (e) {
    console.error("[skill] could not refresh the living-map skill:", e);
  }

const auth = createAuth({ home: HOME, port: PORT });

createApp(engine, hub, auth).listen(PORT, "127.0.0.1", () =>
  console.log(
    `Living Map on http://localhost:${PORT}  (${provider.name}, working in ${MODEL_CWD})`,
  ),
);

// the chats the v3 map followed when the server last stopped go on (still
// being tried out: see flags.ts)
if (ledger()) void ledgerServer();
