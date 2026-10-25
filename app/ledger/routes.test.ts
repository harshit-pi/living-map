// The v3 map's routes on a real server: they need the token like every
// /api route, are not there with the flag off, follow a chat linked through
// /api/link, serve its view, take your actions, push "ledger" events, and
// put your answers in the main chat's inbox.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";

import type { ModelProvider } from "../server/providers/types.ts";
import type { LedgerView } from "../shared/ledger.ts";
import type { ServerEvent } from "../shared/model.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ledger-routes-"));
process.env.LIVING_MAP_HOME = path.join(tmp, "living-map");
process.env.LIVING_MAP_LEDGER = "0";

const { createAuth } = await import("../server/auth.ts");
const { createEngine } = await import("../server/engine.ts");
const { createApp } = await import("../server/http.ts");
const { ledgerServer } = await import("../server/ledger.ts");

// a chat on disk, in the shapes Claude Code writes
const transcript = path.join(tmp, "chat-1.jsonl");
const line = (d: object) => `${JSON.stringify(d)}\n`;
fs.writeFileSync(
  transcript,
  line({
    parentUuid: null,
    type: "user",
    uuid: "a",
    timestamp: new Date().toISOString(),
    cwd: tmp,
    message: { role: "user", content: "Should we ship it today?" },
    origin: { kind: "human" },
    promptSource: "sdk",
  }) +
    line({
      parentUuid: "a",
      type: "assistant",
      uuid: "b",
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "text", text: "It is ready. Ship it now?" }],
        stop_reason: "end_turn",
      },
    }),
);
const ago = (Date.now() - 60_000) / 1000;
fs.utimesSync(transcript, ago, ago);

const provider: ModelProvider = {
  name: "scripted",
  models: [{ id: "", label: "Default" }],
  efforts: [{ id: "", label: "Default" }],
  findConversation: () => ({
    id: "chat-1",
    cwd: tmp,
    title: "Shipping",
    file: transcript,
  }),
  run() {
    const reply = {
      ok: true,
      final: "Hm.",
      firstMs: 1,
      endMs: 1,
      usage: Promise.resolve(null),
    };
    return { reply: Promise.resolve(reply), cancel: () => {} };
  },
  extract: async () => ({
    ok: true,
    value: {
      topics: [{ turn: 1, topic: "new1" }],
      ops: [
        {
          op: "create",
          ref: "new1",
          type: "topic",
          title: "Shipping",
          quote: "Should we ship it today?",
          turn: 1,
        },
        {
          op: "create",
          type: "ask",
          title: "Ship it now?",
          quote: "Ship it now?",
          turn: 1,
          parent: "new1",
        },
      ],
    },
    ms: 1,
    usage: {
      input: 1,
      output: 1,
      costUsd: 0.001,
      model: "scripted",
      effort: "low",
    },
  }),
};

const events: ServerEvent[] = [];
const hub = { add() {}, remove() {}, emit: (e: ServerEvent) => events.push(e) };
const engine = createEngine({ provider, hub, initial: null, save: () => {} });
const port = await new Promise<number>((done) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => done(p));
  });
});
const auth = createAuth({ home: process.env.LIVING_MAP_HOME, port });
const server = createApp(engine, hub, auth).listen(port, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
afterAll(async () => {
  (await ledgerServer())?.ledger.close();
  await new Promise((r) => server.close(r));
});

function call(
  method: string,
  url: string,
  body?: unknown,
  token: string | null = auth.token,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((done, fail) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: url,
        headers: {
          host: `localhost:${port}`,
          "content-type": "application/json",
          ...(token ? { "x-lm-token": token } : {}),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c));
        res.on("end", () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            // not JSON: the status says enough
          }
          done({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test("off with the flag off, and every route needs the token", async () => {
  assert.equal((await call("GET", "/api/ledger/view")).status, 404);
  process.env.LIVING_MAP_LEDGER = "1";
  assert.equal(
    (await call("GET", "/api/ledger/view", undefined, null)).status,
    401,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/api/ledger/act",
        { action: { type: "looked" } },
        null,
      )
    ).status,
    401,
  );
  // on, but nothing linked yet
  assert.equal((await call("GET", "/api/ledger/view")).status, 404);
});

test("a chat linked through /api/link is followed, filed and acted on", async () => {
  process.env.LIVING_MAP_LEDGER = "1";
  const linked = await call("POST", "/api/link", {
    session: "chat-1",
    purpose: "explore",
    question: "Ship it?",
  });
  assert.equal(linked.status, 200);
  const l = (await ledgerServer())!.ledger;
  assert.deepEqual(l.following(), ["chat-1"]);
  await l.tick();

  const got = await call("GET", "/api/ledger/view?conv=chat-1");
  assert.equal(got.status, 200);
  const v = got.json as unknown as LedgerView;
  assert.equal(v.conv, "chat-1");
  assert.equal(v.read, 1);
  const ask = v.items.find((i) => i.type === "ask")!;
  assert.deepEqual(v.strip.waiting, [ask.id]);
  assert.ok(
    events.some((e) => e.type === "ledger" && e.view.items.length === 2),
  );
  // with no conv named: the one linked last
  assert.equal(
    ((await call("GET", "/api/ledger/view")).json as LedgerView).conv,
    "chat-1",
  );

  const bad = await call("POST", "/api/ledger/act", {
    conv: "chat-1",
    action: { type: "state", item: ask.id, state: "taken" },
  });
  assert.equal(bad.status, 400);
  const acted = await call("POST", "/api/ledger/act", {
    conv: "chat-1",
    action: { type: "answer", item: ask.id, text: "Yes, ship it." },
  });
  assert.equal(acted.status, 200);
  const after = acted.json as unknown as LedgerView;
  assert.equal(after.items.find((i) => i.id === ask.id)!.state, "done");
  assert.deepEqual(after.strip.waiting, []);

  // sent, and not yet taken by the chat
  const sent = after.items.find((i) => i.id === ask.id)!.sent!;
  assert.equal(sent.heard, false);
  assert.ok(sent.at > 0);

  // the main chat hears it through its inbox, as the hook asks
  const inbox = await call("POST", "/api/inbox", { session: "chat-1" });
  assert.match(
    String(inbox.json.text),
    /answered "Ship it now\?": Yes, ship it\./,
  );
  // and the card can say Claude has it
  const heard = (await call("GET", "/api/ledger/view?conv=chat-1"))
    .json as unknown as LedgerView;
  assert.equal(heard.items.find((i) => i.id === ask.id)!.sent!.heard, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(
    events.some(
      (e) =>
        e.type === "ledger" &&
        e.view.items.find((i) => i.id === ask.id)?.sent?.heard === true,
    ),
    "pushed to the page when the chat took it",
  );
});
