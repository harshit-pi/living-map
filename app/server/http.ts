// The HTTP surface: live events, actions, the maps list, the model's pickers,
// and the built browser app.

import express from "express";
import path from "node:path";

import type { ActionRequest, ProviderInfo } from "../shared/model.ts";
import { act } from "./actions/index.ts";
import { STATIC_DIR } from "./config.ts";
import type { Engine } from "./engine.ts";
import type { Hub } from "./events.ts";
import { listMaps } from "./store.ts";
import { checkForUpdate, runUpdate } from "./update.ts";

export function createApp(engine: Engine, hub: Hub) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    hub.add(res, engine.snapshot());
    req.on("close", () => hub.remove(res));
  });

  app.post("/api/action", async (req, res) => {
    try {
      res.json(await act(engine, (req.body ?? {}) as ActionRequest));
    } catch (e) {
      console.error("[action] failed:", e);
      res
        .status(500)
        .json({ error: "Something went wrong on the server. Try again." });
    }
  });

  app.get("/api/maps", (_req, res) => {
    res.json(listMaps(engine.state.map?.id ?? null));
  });

  app.get("/api/provider", (_req, res) => {
    const { name, models, efforts } = engine.provider;
    res.json({ name, models, efforts } satisfies ProviderInfo);
  });

  // is a newer release out? (?refresh=1 asks GitHub again now)
  app.get("/api/update", async (req, res) => {
    res.json(await checkForUpdate({ force: req.query.refresh === "1" }));
  });

  // pull, install, build, restart; progress goes to every tab as "update" events
  app.post("/api/update", (_req, res) => {
    res.json({ started: true });
    void runUpdate((s) => hub.emit({ type: "update", ...s }), {
      beforeRestart: () => engine.stop(),
    }).then((r) => {
      if (!r.ok)
        hub.emit({
          type: "update",
          step: "Update stopped",
          state: "failed",
          message: r.error,
        });
    });
  });

  app.use(express.static(STATIC_DIR));
  // every other path is the app itself
  app.use((_req, res) => res.sendFile(path.join(STATIC_DIR, "index.html")));
  return app;
}
