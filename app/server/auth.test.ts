// Who may talk to the server: every /api route but the health check needs the
// token, the update one included; a page on another site, or another name
// for localhost, is refused even with it; and the page signs in once, by a
// link that works one time.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";

import type { ModelProvider } from "./providers/types.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auth-"));
process.env.LIVING_MAP_HOME = path.join(tmp, "living-map");

const { createAuth, readToken } = await import("./auth.ts");
const { createEngine } = await import("./engine.ts");
const { createApp } = await import("./http.ts");

const port = await new Promise<number>((done) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => done(p));
  });
});

const provider: ModelProvider = {
  name: "none",
  models: [{ id: "", label: "Default" }],
  efforts: [{ id: "", label: "Default" }],
  findConversation: () => null,
  run() {
    throw new Error("no model calls here");
  },
};
const engine = createEngine({
  provider,
  hub: { add: () => {}, remove: () => {}, emit: () => {} },
  initial: null,
  save: () => {},
});
const home = process.env.LIVING_MAP_HOME;
const auth = createAuth({ home, port });
const server = createApp(
  engine,
  { add() {}, remove() {}, emit() {} },
  auth,
).listen(port, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
afterAll(() => new Promise((r) => server.close(r)));

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };
function call(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<Res> {
  return new Promise((done, fail) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: url,
        headers: { host: `localhost:${port}`, ...headers },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          done({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", fail);
    if (method === "POST") {
      req.setHeader("content-type", "application/json");
      req.end("{}");
    } else req.end();
  });
}

// every /api route the server has but the health check (the first test
// fails when one is added and not listed here)
const ROUTES: [string, string][] = [
  ["GET", "/api/events"],
  ["POST", "/api/action"],
  ["POST", "/api/link"],
  ["GET", "/api/outline"],
  ["POST", "/api/inbox"],
  ["GET", "/api/inbox/wait?session=x&timeout=1"],
  ["GET", "/api/maps"],
  ["GET", "/api/provider"],
  ["GET", "/api/update"],
  ["POST", "/api/update"],
  ["GET", "/api/session"],
];

test("the list above holds every route the server has", () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, "http.ts"),
    "utf8",
  );
  const found = [...src.matchAll(/app\.(get|post)\("(\/api\/[\w/]+)"/g)]
    .map((m) => `${m[1].toUpperCase()} ${m[2]}`)
    .filter((r) => r !== "GET /api/health");
  const listed = new Set(ROUTES.map(([m, u]) => `${m} ${u.split("?")[0]}`));
  for (const r of found) assert.ok(listed.has(r), `${r} is not tested`);
});

test("the token is kept in a file only you can read, and kept across restarts", () => {
  assert.equal(readToken(home), auth.token);
  assert.equal(fs.statSync(path.join(home, "token")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(home).mode & 0o777, 0o700);
  assert.equal(createAuth({ home, port }).token, auth.token);
});

test("without the token every route is refused, the update one included", async () => {
  for (const [method, url] of ROUTES) {
    const r = await call(method, url);
    assert.equal(r.status, 401, `${method} ${url}`);
    const wrong = await call(method, url, { "x-lm-token": "nope" });
    assert.equal(wrong.status, 401, `${method} ${url} with a wrong token`);
  }
});

test("the health check is open, and says nothing about you", async () => {
  const r = await call("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { app: "living-map", ok: true });
});

test("another name for localhost is refused, even with the token", async () => {
  for (const host of [
    `evil.example:${port}`,
    `localhost:${port + 1}`,
    `127.0.0.1.nip.io:${port}`,
  ]) {
    const r = await call("GET", "/api/maps", {
      host,
      "x-lm-token": auth.token,
    });
    assert.equal(r.status, 403, host);
  }
  // the page too: a rebound name gets nothing of it
  assert.equal((await call("GET", "/", { host: "evil.example" })).status, 403);
});

test("a page on another site is refused, even with the token", async () => {
  for (const origin of [
    "https://evil.example",
    `http://localhost:${port + 1}`,
    "null",
  ]) {
    const r = await call("POST", "/api/update", {
      origin,
      "x-lm-token": auth.token,
    });
    assert.equal(r.status, 403, origin);
  }
});

test("the token lets you in, from the page itself or from no page", async () => {
  const bare = await call("GET", "/api/maps", { "x-lm-token": auth.token });
  assert.equal(bare.status, 200);
  const page = await call("GET", "/api/maps", {
    "x-lm-token": auth.token,
    origin: `http://localhost:${port}`,
  });
  assert.equal(page.status, 200);
});

test("the sign-in link works once, and its cookie reads but never writes", async () => {
  const code = auth.signInCode();
  const first = await call("GET", `/auth?n=${code}`);
  assert.equal(first.status, 302);
  const cookie = String(first.headers["set-cookie"]?.[0] ?? "");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.equal((await call("GET", `/auth?n=${code}`)).status, 401);
  assert.equal((await call("GET", "/auth?n=made-up")).status, 401);

  const jar = cookie.split(";")[0];
  const session = await call("GET", "/api/session", { cookie: jar });
  assert.equal(session.status, 200);
  assert.equal(JSON.parse(session.body).token, auth.token);
  // a write needs the header: a cookie is sent by any page on localhost
  for (const url of ["/api/update", "/api/action", "/api/link"])
    assert.equal((await call("POST", url, { cookie: jar })).status, 401, url);
});

test("an expired sign-in link is refused", async () => {
  const realNow = Date.now;
  const code = auth.signInCode();
  Date.now = () => realNow() + 61_000;
  try {
    assert.equal(auth.redeem(code), null);
  } finally {
    Date.now = realNow;
  }
});

test("with the conversation layer off, the chat's listener is told to stop", async () => {
  assert.equal(process.env.LIVING_MAP_EXPERIMENTAL, undefined);
  const h = { "x-lm-token": auth.token };
  const wait = await call("GET", "/api/inbox/wait?session=x&timeout=1", h);
  assert.deepEqual(JSON.parse(wait.body), { text: "", off: true });
  const inbox = await call("POST", "/api/inbox", h);
  assert.deepEqual(JSON.parse(inbox.body), { text: "" });
});
