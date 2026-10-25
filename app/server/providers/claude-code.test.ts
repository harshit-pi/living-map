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

test("extract runs a fresh call with its own instructions, no tools and no cache, and returns the structured answer", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, cwd: home, spawn });
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
  const provider = claudeCode({ home, cwd: home, spawn });
  const call = provider.extract!({ system: "s", message: "m", schema: {} });
  assert.ok(!procs[0].args.includes("--model"));
  procs[0].say([{ type: "result", subtype: "success", structured_output: {} }]);
  procs[0].end();
  assert.equal((await call).ok, true);
});

test("extract reports an answer with no structured output, or none at all, as a failure", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, cwd: home, spawn });
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
  const provider = claudeCode({ home, cwd: home, spawn });
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
