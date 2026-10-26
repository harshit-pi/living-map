// Living Map server: follows your Claude Code chats as they grow, files what
// is new into a map of each (app/ledger/), and pushes every change to the
// page beside the chat.
//
//   chat transcript ──new turns──► ledger ──► provider (claude -p) ──► ~/.living-map/ledger.db
//   page ◄── GET /api/events (server-sent events) ── every change
//
// Run with Node 23.6+ (types are stripped natively): node server/index.ts

import { createAuth } from "./auth.ts";
import { HOME, PORT, PROVIDER } from "./config.ts";
import { createHub } from "./events.ts";
import { createApp } from "./http.ts";
import { pickProvider } from "./providers/index.ts";
import { startLedger } from "../ledger/routes.ts";
import { installSkill } from "../skill/install.ts";

const provider = pickProvider(PROVIDER, { home: HOME });
const hub = createHub();
// the chats followed when the server last stopped go on
const map = startLedger(provider, hub);

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

createApp(provider, hub, auth, map).listen(PORT, "127.0.0.1", () =>
  console.log(`Living Map on http://localhost:${PORT}  (${provider.name})`),
);
