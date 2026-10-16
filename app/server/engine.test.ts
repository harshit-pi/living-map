// The engine and actions with a scripted model in place of Claude Code: proves
// the provider seam, and pins down queueing, Stop, and instant scene checks.

import assert from "node:assert/strict";
import { test } from "vitest";

import type { ServerEvent } from "../shared/model.ts";
import { act } from "./actions/index.ts";
import type { StoredMap } from "./core/types.ts";
import { createEngine } from "./engine.ts";
import type { Hub } from "./events.ts";
import type {
  ModelProvider,
  ModelReply,
  ModelRequest,
} from "./providers/types.ts";
import { newMap, normalise } from "./store.ts";

// A model whose replies the test writes and releases by hand.
function scripted() {
  const calls: {
    req: ModelRequest;
    release: (text: string) => void;
    cancelled: boolean;
  }[] = [];
  const provider: ModelProvider = {
    name: "scripted",
    models: [{ id: "", label: "Default" }],
    efforts: [{ id: "", label: "Default" }],
    run(req, onText) {
      let release: (text: string) => void = () => {};
      const call = {
        req,
        release: (t: string) => release(t),
        cancelled: false,
      };
      const reply = new Promise<ModelReply>((resolve) => {
        release = (text) => {
          onText(text);
          resolve({
            ok: true,
            final: text,
            firstMs: 1,
            endMs: 2,
            usage: Promise.resolve({
              input: 10,
              output: 5,
              costUsd: 0.01,
              model: "scripted",
              effort: "",
            }),
          });
        };
      });
      calls.push(call);
      return {
        reply,
        cancel: () => {
          call.cancelled = true;
          release("");
        },
      };
    },
  };
  return { provider, calls };
}

function setup(initial: StoredMap | null = null) {
  const { provider, calls } = scripted();
  const events: ServerEvent[] = [];
  const hub: Hub = {
    add: () => {},
    remove: () => {},
    emit: (e) => events.push(e),
  };
  const engine = createEngine({ provider, hub, initial, save: () => {} });
  return { engine, calls, events };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settled = async (calls: unknown[], n: number) => {
  for (let i = 0; i < 50 && calls.length < n; i++) await tick();
};

const ROOT =
  'Laid out.\n```map\n{"ops":[\n{"op":"add","id":"q","parent":null,"kind":"question","title":"Which DB?"},\n{"op":"add","id":"pg","parent":"q","kind":"option","title":"Postgres"}\n]}\n```';

test("a move streams the model reply onto the canvas, through the provider only", async () => {
  const { engine, calls } = setup();
  const done = act(engine, {
    type: "new",
    text: "Which DB?",
    purpose: "explore",
  });
  await settled(calls, 1);
  assert.match(calls[0].req.system, /EXPLORATION CANVAS/);
  assert.match(calls[0].req.message, /ACTION: start/);
  calls[0].release(ROOT);
  await done;
  const m = engine.state.map;
  assert.ok(m);
  assert.equal(m.nodes.pg.title, "Postgres");
  assert.equal(m.chat.at(-1)?.text, "Laid out.");
  await tick();
  assert.equal(m.usage.turns, 1, "usage recorded when the provider reports it");
});

test("moves asked while the model is busy wait their turn instead of being refused", async () => {
  const { engine, calls } = setup();
  const first = act(engine, {
    type: "new",
    text: "Which DB?",
    purpose: "explore",
  });
  await settled(calls, 1);
  calls[0].release(ROOT);
  await first;
  const a = act(engine, { type: "message", text: "one", selection: [] });
  const b = act(engine, { type: "message", text: "two", selection: [] });
  await settled(calls, 2);
  assert.equal(calls.length, 2, "only the first runs");
  assert.equal(engine.state.waiting.length, 1, "the second is visibly waiting");
  calls[1].release("First.");
  await a;
  await settled(calls, 3);
  assert.match(calls[2].req.message, /USER SAYS: two/);
  calls[2].release("Second.");
  assert.deepEqual(await b, {});
});

test("Stop ends the running move and cancels what waits", async () => {
  const { engine, calls } = setup();
  const first = act(engine, {
    type: "new",
    text: "Which DB?",
    purpose: "explore",
  });
  await settled(calls, 1);
  calls[0].release(ROOT);
  await first;
  const running = act(engine, { type: "message", text: "one", selection: [] });
  const waiting = act(engine, { type: "message", text: "two", selection: [] });
  await settled(calls, 2);
  await act(engine, { type: "stop" });
  assert.equal(calls[1].cancelled, true);
  await running;
  assert.deepEqual(await waiting, { error: "Cancelled." });
  assert.equal(engine.state.map?.chat.at(-1)?.text, "Stopped.");
  assert.equal(calls.length, 2, "the waiting move never reached the model");
});

test("an explanation is never asked for twice", async () => {
  const { engine, calls } = setup();
  const first = act(engine, {
    type: "new",
    text: "Which DB?",
    purpose: "explore",
  });
  await settled(calls, 1);
  calls[0].release(ROOT);
  await first;
  const one = act(engine, { type: "explain", nodeId: "pg" });
  assert.deepEqual(await act(engine, { type: "explain", nodeId: "pg" }), {});
  await settled(calls, 2);
  calls[1].release(
    'Explained.\n```map\n{"ops":[{"op":"update","id":"pg","detail":"Relational."}]}\n```',
  );
  await one;
  assert.equal(calls.length, 2);
  assert.deepEqual(
    await act(engine, { type: "explain", nodeId: "pg" }),
    {},
    "written once, never again",
  );
});

test("scene moves are checked on the server, with no model call", async () => {
  const m = newMap("Search", "learn");
  m.nodes.s = {
    id: "s",
    parent: null,
    kind: "question",
    title: "Find 7",
    summary: "",
    detail: "",
    status: "open",
    by: "claude",
    updatedAt: 0,
    order: 0,
  };
  m.scenes.s = {
    kind: "array",
    title: "Find 7",
    complete: true,
    start: { items: ["2", "7"], pointers: [], marks: [], note: "" },
    moves: [
      {
        ask: "Where is 7?",
        answer: { type: "index", keys: ["1"] },
        why: "Yes",
        wrong: { "0": "That is 2" },
        choices: [],
        then: { items: ["2", "7"], pointers: [], marks: [], note: "" },
      },
    ],
  };
  const { engine, calls } = setup(m);
  assert.deepEqual(await act(engine, { type: "play", nodeId: "s", key: "0" }), {
    ok: false,
  });
  assert.deepEqual(await act(engine, { type: "play", nodeId: "s", key: "1" }), {
    ok: true,
  });
  assert.equal(
    m.nodes.s.status,
    "answered",
    "finishing the scene credits the step",
  );
  assert.equal(calls.length, 0);
});

test('maps saved as "decide" open as "explore"', () => {
  assert.equal(
    normalise({ ...newMap("Old", "explore"), purpose: "decide" } as never)
      .purpose,
    "explore",
  );
  assert.equal(normalise({ ...newMap("L", "learn") }).purpose, "learn");
});
