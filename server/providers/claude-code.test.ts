// The Claude Code provider's spare process, on a fake `claude`: at most one is
// kept, keyed by everything fixed when it starts; a move takes it only when
// that key matches, and it is ended when idle, on another key, or released.

import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, test, vi } from "vitest";

import { childEnv, claudeCode, type Spawn } from "./claude-code.ts";

afterEach(() => {
  vi.useRealTimers();
});

type Fake = ChildProcess & {
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  sent: string;
  say: (events: unknown[]) => void;
  end: () => void;
};

function fakeSpawn() {
  const procs: Fake[] = [];
  const spawn: Spawn = (_cmd, args, opts) => {
    const p = new EventEmitter() as Fake;
    p.cwd = opts.cwd;
    p.env = opts.env;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    p.sent = "";
    const stdin = new Writable({
      write(chunk, _enc, cb) {
        p.sent += chunk;
        cb();
      },
    });
    let exited = false;
    const exit = (signal: NodeJS.Signals | null) => {
      if (exited) return;
      exited = true;
      Object.assign(p, { exitCode: signal ? null : 0, signalCode: signal });
      stdout.end();
      setTimeout(() => p.emit("close", signal ? null : 0, signal), 0);
    };
    Object.assign(p, {
      args,
      stdout,
      stderr,
      stdin,
      exitCode: null,
      signalCode: null,
      killed: false,
      kill: (sig: NodeJS.Signals = "SIGTERM") => {
        Object.assign(p, { killed: true });
        exit(sig);
        return true;
      },
      say: (events: unknown[]) =>
        stdout.write(events.map((e) => `${JSON.stringify(e)}\n`).join("")),
      end: () => exit(null),
    });
    procs.push(p);
    return p;
  };
  return { spawn, procs };
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-provider-"));

test("claude never runs as part of the chat session that started the server", () => {
  const env = childEnv({
    PATH: "/bin",
    HOME: "/h",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "chat",
    CLAUDE_CODE_REMOTE_SESSION_ID: "cse_1",
  });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/h" });
});

test("extract runs a fresh call with its own instructions, no tools and no cache, and returns the structured answer", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const schema = { type: "object", properties: { n: { type: "number" } } };
  const call = provider.extract!({
    system: "File the turns.",
    message: "NEW TURNS: …",
    schema,
    model: "sonnet",
    maxOutputTokens: 3000,
  });
  const p = procs[0];
  const arg = (flag: string) => p.args[p.args.indexOf(flag) + 1];
  assert.equal(arg("--system-prompt"), "File the turns.");
  assert.ok(!p.args.includes("--append-system-prompt"));
  assert.equal(arg("--tools"), "");
  assert.deepEqual(JSON.parse(arg("--json-schema")), schema);
  assert.equal(arg("--output-format"), "json");
  assert.equal(arg("--model"), "sonnet");
  assert.equal(arg("--setting-sources"), "");
  assert.ok(p.args.includes("--no-session-persistence"));
  assert.ok(!p.args.includes("--resume"));
  assert.equal(p.env?.DISABLE_PROMPT_CACHING, "1");
  assert.equal(p.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "3000");
  assert.equal(p.cwd, path.join(home, "extract"));
  p.say([
    {
      type: "result",
      subtype: "success",
      result: "",
      structured_output: { n: 3 },
      total_cost_usd: 0.0005,
      usage: { input_tokens: 900, output_tokens: 120 },
      modelUsage: { "claude-sonnet-5-5": { outputTokens: 120 } },
    },
  ]);
  p.end();
  const r = await call;
  assert.equal(p.sent, "NEW TURNS: …");
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { n: 3 });
  assert.equal(r.usage?.model, "claude-sonnet-5-5");
  assert.equal(r.usage?.costUsd, 0.0005);
});

test("extract with no model passes none, so Claude Code's default model answers", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const call = provider.extract!({ system: "s", message: "m", schema: {} });
  assert.ok(!procs[0].args.includes("--model"));
  procs[0].say([{ type: "result", subtype: "success", structured_output: {} }]);
  procs[0].end();
  assert.equal((await call).ok, true);
});

test("extract reports an answer with no structured output, or none at all, as a failure", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const a = provider.extract!({ system: "s", message: "m", schema: {} });
  procs[0].say([
    { type: "result", subtype: "error_max_turns", is_error: true },
  ]);
  procs[0].end();
  const ra = await a;
  assert.equal(ra.ok, false);
  assert.equal(ra.error, "error_max_turns");
  const b = provider.extract!({ system: "s", message: "m", schema: {} });
  procs[1].end();
  assert.deepEqual((await b).error, "no result");
});

test("extract gives up on a call that hangs, and ends its process", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const r = await provider.extract!({
    system: "s",
    message: "m",
    schema: {},
    timeoutMs: 20,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "timed out");
  assert.equal(procs[0].killed, true);
});
