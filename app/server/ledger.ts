// The v3 map's server side (app/ledger/), still being tried out: imported
// on first use and only while its flag is on (see flags.ts), so a fault in it
// can't reach anyone with the flag off.

import type { Engine } from "./engine.ts";
import type { Hub } from "./events.ts";
import { ledger } from "./flags.ts";
import type { LedgerServer } from "../ledger/routes.ts";
import type { Conversation } from "./providers/types.ts";

let deps: { engine: Engine; hub: Hub } | null = null;
let loading: Promise<LedgerServer> | null = null;

// what the ledger will need once it starts (called by createApp)
export function initLedger(engine: Engine, hub: Hub) {
  deps = { engine, hub };
}

// the ledger, started on first use; null with the flag off or when it
// could not start (said in the log, and tried again next time)
export async function ledgerServer(): Promise<LedgerServer | null> {
  if (!deps || !ledger()) return null;
  const { engine, hub } = deps;
  loading ??= import("../ledger/routes.ts").then((m) =>
    m.startLedger(engine, hub),
  );
  try {
    return await loading;
  } catch (e) {
    console.error("[ledger] could not start:", e);
    loading = null;
    return null;
  }
}

// a chat linked to the map is followed in the ledger too; never fails the link
export async function followInLedger(c: Conversation) {
  try {
    (await ledgerServer())?.ledger.follow(c);
  } catch (e) {
    console.error("[ledger] could not follow the chat:", e);
  }
}

// the main chat took its inbox: the map's cards say "Claude has it" (only
// when the ledger is running; it is never started for this)
export function heardInLedger(session: string) {
  void loading?.then((l) => l.ledger.heard(session)).catch(() => {});
}
