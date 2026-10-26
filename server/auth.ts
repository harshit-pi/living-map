// Who may talk to this server. It listens on localhost, but anything on the
// machine can reach localhost, a web page included: without this, any site
// you visit could post to /api/update (pull and reinstall the app) or put
// words into your Claude Code chat. So every /api route needs the token:
//
// - The token is random, made on first start, and kept in
//   ~/.living-map/token (readable only by you). The skill, hooks and scripts
//   read it from there and send it as X-LM-Token.
// - The page gets it by a one-time sign-in link the skill opens
//   (/auth?n=<code>, valid 5 min), which sets an HttpOnly cookie; the page
//   then asks /api/session for the token to send on writes. SameSite does not
//   separate localhost ports, so a cookie alone never allows a write.
// - A request whose Host isn't this server (DNS rebinding), or a write whose
//   Origin is another page, is refused.

import type express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const COOKIE = "lm_token";
const NONCE_MS = 5 * 60_000;

export type Auth = {
  token: string;
  // a one-time code for the sign-in link
  signInCode: () => string;
  // the cookie value for a code, once; null when it is unknown or expired
  redeem: (code: string) => string | null;
  guard: express.RequestHandler;
};

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function cookieOf(req: express.Request): string {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return "";
}

// The token file and the folder it lives in are yours alone.
export function writeToken(home: string, token: string) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(home, 0o700);
  } catch {
    // a folder we can't change is reported by the write below, if at all
  }
  const file = path.join(home, "token");
  fs.writeFileSync(file, token, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function readToken(home: string): string {
  try {
    return fs.readFileSync(path.join(home, "token"), "utf8").trim();
  } catch {
    return "";
  }
}

export function createAuth({
  home,
  port,
  // kept across restarts (an update restarts the server, and a page signed
  // in before it stays signed in); `npm run forget` or deleting the file
  // makes a new one
  token = readToken(home) || randomBytes(32).toString("hex"),
}: {
  home: string;
  port: number;
  token?: string;
}): Auth {
  writeToken(home, token);
  const codes = new Map<string, number>();
  const hosts = new Set(
    ["localhost", "127.0.0.1", "[::1]"].map((h) => `${h}:${port}`),
  );
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  const guard: express.RequestHandler = (req, res, next) => {
    // DNS rebinding: a page on another name that resolves to 127.0.0.1
    if (!hosts.has(String(req.headers.host ?? ""))) {
      res.status(403).json({ error: "Not this server." });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      res.status(403).json({ error: "Not from this page." });
      return;
    }
    // the page itself, its files and the sign-in link need no token
    if (!req.path.startsWith("/api/")) return next();
    // for the skill's start script: is this server up, and is it ours
    if (req.path === "/api/health" && req.method === "GET") return next();
    const header = String(req.headers["x-lm-token"] ?? "");
    const ok =
      (header && same(header, token)) ||
      // a read may carry the cookie alone (the page's event stream)
      ((req.method === "GET" || req.method === "HEAD") &&
        same(cookieOf(req), token));
    if (!ok) {
      res.status(401).json({
        error: "Open Living Map from your Claude Code chat: /living-map.",
      });
      return;
    }
    next();
  };

  return {
    token,
    guard,
    signInCode() {
      const code = randomBytes(18).toString("base64url");
      const now = Date.now();
      for (const [c, at] of codes) if (now - at > NONCE_MS) codes.delete(c);
      codes.set(code, now);
      return code;
    },
    redeem(code) {
      const at = codes.get(code);
      codes.delete(code);
      return at !== undefined && Date.now() - at <= NONCE_MS ? token : null;
    },
  };
}

// The sign-in link and the page's way to its token.
export function authRoutes(app: express.Express, auth: Auth) {
  app.get("/auth", (req, res) => {
    const code = typeof req.query.n === "string" ? req.query.n : "";
    const token = auth.redeem(code);
    if (!token) {
      res
        .status(401)
        .type("text/plain")
        .send(
          "This sign-in link has expired. Say /living-map in your Claude Code chat for a new one.",
        );
      return;
    }
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    res.redirect(302, "/");
  });
  // only a page already signed in (its cookie) can read this, and no other
  // page can read the answer: the server sends no CORS headers
  app.get("/api/session", (_req, res) => {
    res.json({ token: auth.token });
  });
}
