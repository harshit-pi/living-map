// The HTTP surface: live events, actions, the maps list, the model's pickers,
// and the built browser app.

import express from "express";
import path from "node:path";

import type { ActionRequest, ProviderInfo } from "../shared/model.ts";
import { act } from "./actions/index.ts";
import { link, mapText } from "./actions/link.ts";
import { authRoutes, type Auth } from "./auth.ts";
import { STATIC_DIR } from "./config.ts";
import type { Engine } from "./engine.ts";
import type { Hub } from "./events.ts";
import { listening } from "./flags.ts";
import { heardInLedger, initLedger, ledgerServer } from "./ledger.ts";
import { listMaps, readMap } from "./store.ts";
import { checkForUpdate, runUpdate } from "./update.ts";
import { listen, unsentFor, wakesFor } from "../layer/view.ts";

export function createApp(engine: Engine, hub: Hub, auth: Auth) {
  initLedger(engine, hub);
  const app = express();
  app.disable("x-powered-by");
  // before anything else: who may ask (see auth.ts)
  app.use(auth.guard);
  authRoutes(app, auth);
  app.use(express.json({ limit: "1mb" }));
  // a body that is not JSON gets a plain error, never a stack trace
  app.use(
    (
      err: { status?: number; type?: string },
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!err) return next();
      res
        .status(err.status && err.status < 500 ? err.status : 400)
        .json({ error: "That request is not valid." });
    },
  );

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
      const r = await act(engine, (req.body ?? {}) as ActionRequest);
      // an action that did not go through says so with the status too
      res.status(r.error ? 400 : 200).json(r);
    } catch (e) {
      console.error("[action] failed:", e);
      res
        .status(500)
        .json({ error: "Something went wrong on the server. Try again." });
    }
  });

  // for the living-map skill: is the server up, and is it this app
  app.get("/api/health", (_req, res) => {
    // open to anyone on the machine, so it says nothing about your maps
    res.json({ app: "living-map", ok: true });
  });

  // open (or start) the map of one of your conversations, from that
  // conversation (the living-map skill)
  app.post("/api/link", async (req, res) => {
    try {
      const r = await link(engine, (req.body ?? {}) as Record<string, unknown>);
      // the page to open: signed in by a one-time link
      res
        .status(r.error ? 400 : 200)
        .json(r.error ? r : { ...r, url: `/auth?n=${auth.signInCode()}` });
    } catch (e) {
      console.error("[link] failed:", e);
      res
        .status(500)
        .json({ error: "Something went wrong on the server. Try again." });
    }
  });

  // a map as plain text, for a conversation to read back (the open one if
  // no id is given)
  app.get("/api/outline", (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    const current = engine.state.map;
    const m = !id || id === current?.id ? current : readMap(id);
    if (!m) {
      res.status(404).type("text/plain").send("No such map.");
      return;
    }
    res.type("text/plain").send(mapText(engine, m));
  });

  // what your conversation has not heard from its maps (side chats, ticks,
  // what you did on its views),
  // asked by the living-map hook each time you write there; marked heard
  app.post("/api/inbox", (req, res) => {
    const id =
      typeof req.body?.session === "string"
        ? req.body.session.slice(0, 100)
        : "";
    if (!id || !listening()) {
      res.json({ text: "" });
      return;
    }
    const text = unsentFor(id);
    // the rail's "for your chat" count drops now it is heard
    if (text) {
      engine.push();
      heardInLedger(id);
    }
    res.json({ text });
  });

  // The listener in your main chat (skill/wait.ts) waits here: answered as
  // soon as the map has something it should hear now, else empty after
  // `timeout` seconds (at most 25 minutes), and it asks again.
  app.get("/api/inbox/wait", (req, res) => {
    const id =
      typeof req.query.session === "string"
        ? req.query.session.slice(0, 100)
        : "";
    const secs = Math.min(1500, Math.max(1, Number(req.query.timeout) || 600));
    // the conversation layer is off: nothing will come, so the listener stops
    if (!listening()) {
      res.json({ text: "", off: true });
      return;
    }
    if (!id) {
      res.json({ text: "" });
      return;
    }
    listen(id, 1);
    engine.push();
    let over = false;
    const end = (text: string) => {
      if (over) return;
      over = true;
      clearInterval(tick);
      clearTimeout(limit);
      listen(id, -1);
      if (!res.writableEnded) res.json({ text });
      engine.push();
    };
    const tick = setInterval(() => {
      if (!wakesFor(id)) return;
      end(unsentFor(id));
      heardInLedger(id);
    }, 1000);
    const limit = setTimeout(() => end(""), secs * 1000);
    // the listener went away (its chat stopped it): no longer waiting
    res.on("close", () => end(""));
  });

  // the v3 map (app/ledger/), only while its flag is on (see flags.ts)
  app.use("/api/ledger", (req, res, next) => {
    void ledgerServer().then(
      (l) => {
        if (l) l.router(req, res, next);
        else res.status(404).json({ error: "Not found." });
      },
      () =>
        res
          .status(500)
          .json({ error: "Something went wrong on the server. Try again." }),
    );
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
      beforeRestart: () => engine.stop({ release: true }),
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
