// The v3 map's routes and its start: the store opened, the chats marked
// following picked up again, and every change pushed to open pages as a
// "ledger" event. Loaded only while the experimental flag is on (see
// server/ledger.ts).
//
//   GET  /api/ledger/view?conv=<id>  the map of a chat (the open map's, else
//                                    the one linked last)
//   POST /api/ledger/act {conv, action}  what you did on it

import express from "express";
import fs from "node:fs";
import path from "node:path";

import { compare, shadowFor, snapshot } from "./changes/snapshot.ts";
import { openDb, type Conv } from "./db.ts";
import { createLedger, type Ledger } from "./follow.ts";
import { post } from "../layer/core.ts";
import { layerOf, saveLayer } from "../layer/store.ts";
import { HOME } from "../server/config.ts";
import type { Engine } from "../server/engine.ts";
import type { Hub } from "../server/events.ts";
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

// Words for the main chat go through the conversation layer's outbox, which
// the hook and the listener in that chat already read (layer/view.ts);
// marked to wake the listener, since you answered something it asked.
export function tellChat(conv: Conv, text: string) {
  const ids = conv.ids.length ? conv.ids : [conv.root];
  const s = layerOf({
    id: ids.at(-1)!,
    previous: ids.slice(0, -1),
    cwd: conv.cwd,
    title: conv.title,
  });
  for (const id of ids) if (!s.aliases.includes(id)) s.aliases.push(id);
  post(s, text, Date.now(), true);
  saveLayer(s);
}

export type LedgerServer = { ledger: Ledger; router: express.Router };

export function startLedger(
  engine: Engine,
  hub: Hub,
  file = DB_FILE,
): LedgerServer {
  const db = openDb(file);
  const provider = engine.provider;
  const ledger = createLedger({
    db,
    extract: provider.extract ? (req) => provider.extract!(req) : undefined,
    emit: (e) => hub.emit(e),
    tell: tellChat,
    model: () => ledgerModel(),
    changes: {
      shadowFor: (cwd) => shadowFor(HOME, cwd),
      snapshot,
      compare,
    },
  });
  ledger.resume();

  // the chat asked for, else the open map's, else the one linked last
  const rootFor = (asked: unknown): string | null => {
    if (typeof asked === "string" && asked)
      return ledger.rootOf([asked.slice(0, 100)]);
    const c = engine.state.map?.conversation;
    return (
      (c ? ledger.rootOf([...(c.previous ?? []), c.id]) : null) ??
      ledger.latest()
    );
  };

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
  router.post("/act", (req, res) => {
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
  return { ledger, router };
}
