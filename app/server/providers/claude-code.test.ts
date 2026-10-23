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

import { childEnv, claudeCode, priceOf, type Spawn } from "./claude-code.ts";

afterEach(() => {
  vi.useRealTimers();
});

type Fake = ChildProcess & {
  args: string[];
  cwd: string;
  sent: string;
  say: (events: unknown[]) => void;
  end: () => void;
};

function fakeSpawn() {
  const procs: Fake[] = [];
  const spawn: Spawn = (_cmd, args, opts) => {
    const p = new EventEmitter() as Fake;
    p.cwd = opts.cwd;
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

const ev = (event: unknown) => ({ type: "stream_event", event });
const answer = (text: string) => [
  ev({ type: "message_start" }),
  ev({ type: "content_block_delta", delta: { text } }),
  ev({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
  ev({ type: "message_stop" }),
  {
    type: "result",
    result: text,
    usage: { input_tokens: 3, output_tokens: 4 },
    total_cost_usd: 0.01,
  },
];
const live = (procs: Fake[]) => procs.filter((p) => !p.killed && !p.exitCode);
const tick = () => new Promise((r) => setTimeout(r, 5));

const req = (
  over: Partial<{ system: string; model: string; effort: string }>,
) => ({
  system: "SYS",
  message: "hello",
  model: "",
  effort: "",
  ...over,
});

test("a move with no spare starts its own process and sends its message as one stream-json line", async () => {
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn });
  const call = p.run(req({}), () => {});
  assert.equal(procs.length, 1);
  assert.ok(procs[0].args.includes("--input-format"));
  assert.deepEqual(JSON.parse(procs[0].sent), {
    type: "user",
    message: { role: "user", content: "hello" },
  });
  procs[0].say(answer("Hi."));
  const r = await call.reply;
  assert.equal(r.ok, true);
  assert.equal(r.final, "Hi.");
  assert.equal(r.warm, false);
  assert.equal((await r.usage)?.output, 4);
});

test("a spare started for the same system prompt, model and effort is the one the next move takes", async () => {
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn });
  p.warm!({ system: "SYS", model: "", effort: "low" });
  p.warm!({ system: "SYS", model: "", effort: "" }); // auto is low: the same key
  assert.equal(procs.length, 1, "one spare, started once");
  assert.equal(procs[0].sent, "", "nothing is sent until a move takes it");
  // the CLI's own start-up lines, before any message, are read and ignored
  procs[0].say([{ type: "system", subtype: "init" }]);
  const call = p.run(req({}), () => {});
  assert.equal(procs.length, 1, "no new process");
  assert.match(procs[0].sent, /"content":"hello"/);
  procs[0].say(answer("Warm."));
  const r = await call.reply;
  assert.equal(r.warm, true);
  assert.equal(r.final, "Warm.");
});

test("a move on another key ends the spare and starts its own; there are never two spares", async () => {
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn });
  p.warm!({ system: "SYS", model: "", effort: "" });
  p.warm!({ system: "OTHER", model: "", effort: "" });
  assert.equal(procs.length, 2);
  assert.ok(procs[0].killed, "the first spare is ended on a new key");
  assert.equal(live(procs).length, 1);
  for (const over of [
    { system: "SYS" },
    { model: "opus" },
    { effort: "high" },
  ]) {
    p.warm!({ system: "OTHER", model: "", effort: "" });
    const before: number = procs.length;
    const call = p.run(req(over), () => {});
    assert.equal(
      procs.length,
      before + 1,
      `${JSON.stringify(over)} starts fresh`,
    );
    assert.ok(procs[before - 1].killed, "the spare for another key is ended");
    procs.at(-1)!.say(answer("x"));
    assert.equal((await call.reply).warm, false);
  }
  assert.ok(procs.at(-1)!.args.includes("high"));
});

test("a spare idle past its time is ended; release ends it at once", async () => {
  vi.useFakeTimers();
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn, idleMs: 1000 });
  p.warm!({ system: "SYS" });
  vi.advanceTimersByTime(600);
  p.warm!({ system: "SYS" }); // asked again: its idle time starts over
  vi.advanceTimersByTime(600);
  assert.equal(procs[0].killed, false);
  vi.advanceTimersByTime(500);
  assert.equal(procs[0].killed, true);
  p.warm!({ system: "SYS" });
  p.release!();
  assert.equal(procs[1].killed, true);
  vi.useRealTimers();
  // nothing is left to take: the next move starts its own
  const call = p.run(req({}), () => {});
  assert.equal(procs.length, 3);
  procs[2].say(answer("x"));
  assert.equal((await call.reply).warm, false);
});

test("a spare that has died is not taken; one that ends before answering is replaced by a fresh process", async () => {
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn });
  p.warm!({ system: "SYS" });
  procs[0].end();
  await tick();
  const first = p.run(req({}), () => {});
  assert.equal(procs.length, 2, "a dead spare is passed over");
  procs[1].say(answer("a"));
  assert.equal((await first.reply).final, "a");

  p.warm!({ system: "SYS" });
  const second = p.run(req({}), () => {});
  assert.equal(procs.length, 3);
  procs[2].end(); // quits after taking the message, having said nothing
  await tick();
  assert.equal(procs.length, 4, "the move starts its own");
  assert.match(procs[3].sent, /"content":"hello"/);
  procs[3].say(answer("b"));
  const r = await second.reply;
  assert.equal(r.final, "b");
  assert.equal(r.warm, false);
});

test("cancel ends the move's process, warm or not, and it is not started again", async () => {
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn });
  p.warm!({ system: "SYS" });
  const call = p.run(req({}), () => {});
  call.cancel();
  const r = await call.reply;
  assert.equal(procs.length, 1);
  assert.ok(procs[0].killed);
  assert.equal(r.ok, false);
});

test("the reply is complete at message_stop, before the CLI's result arrives", async () => {
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn });
  let streamed = "";
  const call = p.run(req({}), (t) => (streamed = t));
  procs[0].say(answer("Done.").slice(0, 4));
  const r = await call.reply;
  assert.equal(r.final, "Done.");
  assert.equal(streamed, "Done.");
  procs[0].say(answer("Done.").slice(4));
  assert.equal((await r.usage)?.output, 4);
});

test("a move on a linked map resumes your conversation, forked and unsaved, from the folder it started in", async () => {
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn });
  const where = fs.mkdtempSync(path.join(os.tmpdir(), "lm-project-"));
  const call = p.run(
    { ...req({}), conversation: { id: "abc-123", cwd: where, title: "T" } },
    () => {},
  );
  const args = procs[0].args;
  assert.equal(args[args.indexOf("--resume") + 1], "abc-123");
  assert.ok(args.includes("--fork-session"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(procs[0].cwd, where);
  procs[0].say(answer("Linked."));
  assert.equal((await call.reply).final, "Linked.");
});

test("a spare that read your conversation before you said more there is not taken", async () => {
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn });
  const file = path.join(home, "conv.jsonl");
  fs.writeFileSync(file, "{}\n");
  const conversation = { id: "abc-123", cwd: home, title: "T", file };
  p.warm!({ system: "SYS", model: "", effort: "", conversation });
  assert.equal(procs.length, 1);
  fs.appendFileSync(file, '{"type":"user"}\n');
  const call = p.run({ ...req({}), conversation }, () => {});
  assert.equal(procs.length, 2, "a fresh process reads what you said since");
  assert.ok(procs[0].killed, "the stale spare is ended");
  procs[1].say(answer("Fresh."));
  assert.equal((await call.reply).warm, false);
});

test("a linked move is priced from its own tokens, not the resumed conversation's running total", async () => {
  const { spawn, procs } = fakeSpawn();
  const p = claudeCode({ home, cwd: home, spawn });
  const call = p.run(
    { ...req({}), conversation: { id: "abc-123", cwd: home, title: "T" } },
    () => {},
  );
  // a move measured on a 46k-token conversation: everything read from cache
  const usage = {
    input_tokens: 2,
    output_tokens: 4,
    cache_read_input_tokens: 45810,
    cache_creation_input_tokens: 541,
    cache_creation: { ephemeral_1h_input_tokens: 541 },
  };
  procs[0].say([
    ev({ type: "message_start", message: { model: "claude-sonnet-5-5" } }),
    ev({ type: "content_block_delta", delta: { text: "ok" } }),
    ev({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
    ev({ type: "message_stop" }),
    {
      type: "result",
      result: "ok",
      usage,
      // the CLI counts the whole conversation's past cost in its total, and
      // lists the models your chat used
      total_cost_usd: 0.1551,
      modelUsage: { "claude-opus-5-5": { outputTokens: 9000 } },
    },
  ]);
  const u = await (await call.reply).usage;
  assert.equal(u?.model, "claude-sonnet-5-5");
  assert.ok(
    Math.abs((u?.costUsd ?? 0) - priceOf("claude-sonnet-5-5", usage)) < 1e-9,
  );
  assert.ok(Math.abs((u?.costUsd ?? 0) - 0.0114) < 0.0005, `${u?.costUsd}`);
});

test("moves never run as part of the chat session that started the server", () => {
  const env = childEnv({
    PATH: "/bin",
    HOME: "/h",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "chat",
    CLAUDE_CODE_REMOTE_SESSION_ID: "cse_1",
  });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/h" });
});
