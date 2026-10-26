// The map's routes and its start: the store opened, the chats marked
// following picked up again, and every change pushed to open pages as a
// "ledger" event.
//
//   GET  /api/ledger/view?conv=<id>  the map of a chat (else the one linked last)
//   POST /api/ledger/act {conv, action}  what you did on it; a side chat's
//                                        actions (sides.ts) answer {side, view}

import express from "express";
import fs from "node:fs";
import path from "node:path";

import { compare, shadowFor, snapshot } from "./changes/snapshot.ts";
import { openDb, type Conv } from "./db.ts";
import { createLedger, type Ledger } from "./follow.ts";
import { heardAt as heardAtOf, post } from "./outbox.ts";
import { createSides, itemsPage, type Sides } from "./sides.ts";
import { HOME } from "../server/config.ts";
import type { Hub } from "../server/events.ts";
import type { ModelProvider } from "../server/providers/types.ts";
import type { LedgerAction } from "../shared/ledger.ts";

export const DB_FILE = path.join(HOME, "ledger.db");

// {"ledgerModel": "..."} in ~/.living-map/settings.json picks the
// extractor's model; Claude Code's default otherwise
export function ledgerModel(home = HOME): string {
  try {
    const s = JSON.parse(
      fs.readFileSync(path.join(home, "settings.json"), "utf8"),
    ) as { ledgerModel?: unknown };
    return typeof s.ledgerModel === "string" ? s.ledgerModel.slice(0, 80) : "";
  } catch {
    return "";
  }
}

const idsOf = (conv: Conv) => (conv.ids.length ? conv.ids : [conv.root]);

// Words for the main chat go to its outbox (outbox.ts), which the hook and
// the listener in that chat read. Marked to wake the listener, since you
// acted on something it is part of; `quiet` ones (a side chat's finding you
// applied) wait for your next message there.
export function tellChat(conv: Conv, text: string, quiet = false) {
  post(idsOf(conv), conv.title, text, !quiet);
}

// when the main chat last took its inbox: what was told before has arrived
export const heardAt = (conv: Conv) => heardAtOf(idsOf(conv));

export type LedgerServer = {
  ledger: Ledger;
  sides: Sides;
  router: express.Router;
  outline: (conv?: unknown) => string | null;
};

export function startLedger(
  provider: ModelProvider,
  hub: Hub,
  file = DB_FILE,
): LedgerServer {
  const db = openDb(file);
  const ledger = createLedger({
    db,
    extract: provider.extract ? (req) => provider.extract!(req) : undefined,
    emit: (e) => hub.emit(e),
    tell: tellChat,
    heardAt,
    model: () => ledgerModel(),
    changes: {
      shadowFor: (cwd) => shadowFor(HOME, cwd),
      snapshot,
      compare,
    },
  });
  ledger.resume();
  const sides = createSides({
    db,
    ledger,
    emit: (e) => hub.emit(e),
    home: HOME,
    model: () => ledgerModel(),
  });

  // the chat asked for, else the one linked last
  const rootFor = (asked: unknown): string | null =>
    typeof asked === "string" && asked
      ? ledger.rootOf([asked.slice(0, 100)])
      : ledger.latest();

  const router = express.Router();
  router.get("/view", (req, res) => {
    const root = rootFor(req.query.conv);
    const view = root ? ledger.view(root) : null;
    if (!root || !view) {
      res.status(404).json({ error: "No chat is linked to the map yet." });
      return;
    }
    ledger.nudge(root);
    res.json(view);
  });
  router.post("/act", async (req, res) => {
    const body = (req.body ?? {}) as { conv?: unknown; action?: unknown };
    const root = rootFor(body.conv);
    const action = body.action as LedgerAction | undefined;
    if (!root) {
      res.status(404).json({ error: "No chat is linked to the map yet." });
      return;
    }
    if (
      !action ||
      typeof action !== "object" ||
      typeof action.type !== "string"
    ) {
      res.status(400).json({ error: "That action is not valid." });
      return;
    }
    try {
      if (SIDE_ACTIONS.has(action.type)) {
        const r = await sides.act(root, action);
        res
          .status(r.error ? 400 : 200)
          .json(
            r.error
              ? { error: r.error }
              : { side: r.side, view: r.view ?? ledger.view(root) },
          );
        return;
      }
      const r = ledger.act(root, action);
      res
        .status(r.error ? 400 : 200)
        .json(r.error ? { error: r.error } : r.view);
    } catch (e) {
      console.error("[ledger] action failed:", e);
      res
        .status(500)
        .json({ error: "Something went wrong on the server. Try again." });
    }
  });
  // a chat's map as text, for a conversation to read back: every live item
  // in tree order, with what it says
  const outline = (asked: unknown): string | null => {
    const root = rootFor(asked);
    const s = root ? ledger.state(root) : null;
    return s ? itemsPage(s.store) : null;
  };
  return { ledger, sides, router, outline };
}

const SIDE_ACTIONS = new Set<string>([
  "side-open",
  "side-say",
  "side-stop",
  "side-close",
  "apply-proposal",
  "drop-proposal",
]);
