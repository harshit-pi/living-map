// The HTTP surface: live events, the map of your chat, linking a chat, its
// inbox to the chat, the one-click update, and the built page.

import express from "express";
import path from "node:path";

import { authRoutes, type Auth } from "./auth.ts";
import { STATIC_DIR } from "./config.ts";
import type { Hub } from "./events.ts";
import type { ModelProvider } from "./providers/types.ts";
import { checkForUpdate, runUpdate } from "./update.ts";
import { linkChat } from "../ledger/link.ts";
import { unsentFor, wakesFor } from "../ledger/outbox.ts";
import type { LedgerServer } from "../ledger/routes.ts";

const sessionOf = (v: unknown) =>
  typeof v === "string" ? v.slice(0, 100) : "";

export function createApp(
  provider: ModelProvider,
  hub: Hub,
  auth: Auth,
  map: LedgerServer,
) {
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
    hub.add(res, { type: "ping" });
    req.on("close", () => hub.remove(res));
  });

  // for the living-map skill: is the server up, and is it this app
  app.get("/api/health", (_req, res) => {
    // open to anyone on the machine, so it says nothing about your maps
    res.json({ app: "living-map", ok: true });
  });

  // follow one of your chats, from that chat (the living-map skill)
  app.post("/api/link", (req, res) => {
    try {
      const r = linkChat(
        provider,
        map.ledger,
        (req.body ?? {}) as Record<string, unknown>,
      );
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

  // a chat's map as plain text, for a conversation to read back (?conv=<id>,
  // else the one linked last)
  app.get("/api/outline", (req, res) => {
    const text = map.outline(req.query.conv);
    if (text === null)
      res
        .status(404)
        .type("text/plain")
        .send("No chat is linked to the map yet.");
    else res.type("text/plain").send(text);
  });

  // what your chat has not heard from its map, asked by the living-map hook
  // each time you write there; marked heard
  app.post("/api/inbox", (req, res) => {
    const id = sessionOf(req.body?.session);
    const text = id ? unsentFor(id) : "";
    if (text) map.ledger.heard(id);
    res.json({ text });
  });

  // The listener in your chat (skill/wait.ts) waits here: answered as soon
  // as the map has something it should hear now, else empty after `timeout`
  // seconds (at most 25 minutes), and it asks again.
  app.get("/api/inbox/wait", (req, res) => {
    const id = sessionOf(req.query.session);
    const secs = Math.min(1500, Math.max(1, Number(req.query.timeout) || 600));
    if (!id) {
      res.json({ text: "" });
      return;
    }
    let over = false;
    const end = (text: string) => {
      if (over) return;
      over = true;
      clearInterval(tick);
      clearTimeout(limit);
      if (!res.writableEnded) res.json({ text });
    };
    const tick = setInterval(() => {
      if (!wakesFor(id)) return;
      end(unsentFor(id));
      map.ledger.heard(id);
    }, 1000);
    const limit = setTimeout(() => end(""), secs * 1000);
    // the listener went away (its chat stopped it): no longer waiting
    res.on("close", () => end(""));
  });

  app.use("/api/ledger", map.router);

  // is a newer release out? (?refresh=1 asks GitHub again now)
  app.get("/api/update", async (req, res) => {
    res.json(await checkForUpdate({ force: req.query.refresh === "1" }));
  });

  // pull, install, build, restart; progress goes to every tab as "update" events
  app.post("/api/update", (_req, res) => {
    res.json({ started: true });
    void runUpdate((s) => hub.emit({ type: "update", ...s })).then((r) => {
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
  // every other path is the page itself
  app.use((_req, res) => res.sendFile(path.join(STATIC_DIR, "index.html")));
  return app;
}
