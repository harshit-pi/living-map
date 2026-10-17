// The engine and actions with a scripted model in place of Claude Code: proves
// the provider seam, and pins down queueing, Stop, and instant scene checks.

import assert from "node:assert/strict";
import { test } from "vitest";

import { newState } from "../plugins/design/core.ts";
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

// a topic diagram with one blank on it, to fill
const withBlank = (m: StoredMap, id: string) => {
  m.diagram = {
    form: "structure",
    title: "T",
    boxes: [{ id, blank: true, prompt: "What goes here?", label: "" }],
    arrows: [],
  };
  return m;
};

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
  assert.deepEqual(await waiting, { stopped: true });
  const chat = engine.state.map?.chat.map((c) => c.text) ?? [];
  assert.ok(chat.includes("Stopped."));
  assert.equal(chat.at(-1), "Cancelled before Claude saw it.");
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

test("a blank's verdict is tagged so it shows on the blank, not as a caption", async () => {
  const m = withBlank(newMap("DBs", "learn"), "c2");
  const { engine, calls } = setup(m);
  assert.deepEqual(
    await act(engine, { type: "fill", blankId: "c9", text: "rigid" }),
    { error: "No such blank." },
    "a blank that is not on the diagram costs no model call",
  );
  const done = act(engine, { type: "fill", blankId: "c2", text: "rigid" });
  await settled(calls, 1);
  assert.equal(engine.state.working?.blankId, "c2");
  calls[0].release(
    'Not quite.\n```map\n{"ops":[{"op":"judge","id":"c2","state":"wrong"}]}\n```',
  );
  await done;
  assert.equal(m.chat.at(-1)?.blankId, "c2");
  assert.equal(m.fills.c2.state, "wrong");
});

test("Show answer asks once more when the answer did not arrive, and only then marks it shown", async () => {
  const m = newMap("Rust", "learn");
  m.nodes.step = {
    id: "step",
    parent: null,
    kind: "question",
    title: "Who frees memory?",
    summary: "",
    detail: "",
    status: "open",
    by: "claude",
    updatedAt: 0,
    order: 0,
  };
  const { engine, calls } = setup(m);
  const done = act(engine, { type: "answer", nodeId: "step" });
  await settled(calls, 1);
  calls[0].release("Here is the answer."); // no map block: nothing delivered
  await settled(calls, 2);
  assert.match(calls[1].req.message, /did not deliver it/);
  calls[1].release(
    'Done.\n```map\n{"ops":[{"op":"update","id":"step","detail":"The owner frees it."}]}\n```',
  );
  const r = await done;
  assert.equal(m.nodes.step.detail, "The owner frees it.");
  assert.equal(m.nodes.step.revealed, true);
  // asked and answered in the step's thread, not the main conversation
  const thread = m.threads[r.threadId ?? ""];
  assert.equal(thread?.nodeId, "step");
  assert.equal(thread.messages[0].text, "Show me the answer.");
  assert.equal(thread.messages.at(-1)?.role, "claude");
  assert.equal(m.chat.length, 0);
});

test("Show answer goes to the thread named on its step, ignores one on another node, and fills the step's blanks", async () => {
  const m = newMap("Rust", "learn");
  const step = (id: string) => ({
    id,
    parent: null,
    kind: "question" as const,
    title: id,
    summary: "",
    detail: "",
    status: "open" as const,
    by: "claude" as const,
    updatedAt: 0,
    order: 0,
  });
  m.nodes.step = step("step");
  m.nodes.other = step("other");
  m.diagram = {
    form: "grid",
    title: "Who frees",
    columns: ["who"],
    rows: [{ label: "heap", cells: [{ id: "c2", text: "?", blank: true }] }],
  };
  m.threads.mine = {
    id: "mine",
    nodeId: "step",
    title: "Thread",
    createdAt: 1,
    messages: [],
  };
  m.threads.later = {
    id: "later",
    nodeId: "step",
    title: "Fork 2",
    createdAt: 2,
    messages: [],
  };
  m.threads.theirs = {
    id: "theirs",
    nodeId: "other",
    title: "Thread",
    createdAt: 3,
    messages: [],
  };
  const { engine, calls } = setup(m);
  const reply =
    'The owner.\n```map\n{"ops":[{"op":"update","id":"step","detail":"The owner frees it."},{"op":"judge","id":"c2","state":"right","label":"owner"}]}\n```';

  const named = act(engine, {
    type: "answer",
    nodeId: "step",
    threadId: "mine",
  });
  await settled(calls, 1);
  calls[0].release(reply);
  assert.equal((await named).threadId, "mine", "the thread you had open");
  assert.equal(m.fills.c2?.state, "right", "the step's blank is filled");

  m.nodes.step.detail = "";
  const elsewhere = act(engine, {
    type: "answer",
    nodeId: "step",
    threadId: "theirs",
  });
  await settled(calls, 2);
  calls[1].release(reply);
  assert.equal(
    (await elsewhere).threadId,
    "later",
    "another node's thread is ignored: the step's latest",
  );
  assert.equal(m.threads.theirs.messages.length, 0);
});

test("Stop during an explanation does not start a second try", async () => {
  const { engine, calls } = setup();
  const first = act(engine, {
    type: "new",
    text: "Which DB?",
    purpose: "explore",
  });
  await settled(calls, 1);
  calls[0].release(ROOT);
  await first;
  const explaining = act(engine, { type: "explain", nodeId: "pg" });
  await settled(calls, 2);
  await act(engine, { type: "stop" });
  assert.deepEqual(await explaining, { stopped: true });
  await tick();
  assert.equal(calls.length, 2, "no second try after Stop");
  assert.equal(engine.state.busy, false);
});

test("a queued message is sent with the reply to the one before it, and only once", async () => {
  const { engine, calls } = setup();
  const first = act(engine, {
    type: "new",
    text: "Which DB?",
    purpose: "explore",
  });
  await settled(calls, 1);
  calls[0].release(ROOT);
  await first;
  const a = act(engine, { type: "message", text: "AAA", selection: [] });
  const b = act(engine, { type: "message", text: "BBB", selection: [] });
  await settled(calls, 2);
  calls[1].release("Reply to AAA.");
  await a;
  await settled(calls, 3);
  const sent = calls[2].req.message;
  assert.match(sent, /YOU: Reply to AAA\./);
  assert.equal(sent.match(/BBB/g)?.length, 1, "BBB appears once, as USER SAYS");
  calls[2].release("Reply to BBB.");
  await b;
});

test("Stop keeps your canvas notes for the next move", async () => {
  const m = newMap("Notes", "explore");
  m.nodes.q = {
    id: "q",
    parent: null,
    kind: "question",
    title: "Q",
    summary: "",
    detail: "",
    status: "open",
    by: "claude",
    updatedAt: 0,
    order: 0,
  };
  m.notes.push("Set aside X");
  const { engine, calls } = setup(m);
  const running = act(engine, { type: "message", text: "hi", selection: [] });
  await settled(calls, 1);
  await act(engine, { type: "stop" });
  await running;
  assert.deepEqual(m.notes, ["Set aside X"]);
});

test("ids the browser sends must be plain", async () => {
  const { engine } = setup(newMap("x", "explore"));
  assert.deepEqual(
    await act(engine, { type: "play", nodeId: "__proto__", key: "1" }),
    {
      error: "That request is not valid.",
    },
  );
  assert.deepEqual(
    await act(engine, { type: "fill", blankId: "constructor", text: "x" }),
    {
      error: "That request is not valid.",
    },
  );
});

test("a new map that draws nothing says so instead of loading forever", async () => {
  const { engine, calls } = setup();
  const done = act(engine, { type: "new", text: "Anything", purpose: "learn" });
  await settled(calls, 1);
  calls[0].release("I could not draw this.");
  const r = await done;
  assert.match(r.error ?? "", /did not lay anything out/);
});

test("each move sends only the instructions it needs", async () => {
  const m = newMap("Learn", "learn");
  m.nodes.root = {
    id: "root",
    parent: null,
    kind: "question",
    title: "Topic",
    summary: "",
    detail: "",
    status: "open",
    by: "claude",
    updatedAt: 0,
    order: 0,
  };
  m.nodes.step = {
    id: "step",
    parent: "root",
    kind: "question",
    title: "Step",
    summary: "",
    detail: "",
    status: "open",
    by: "claude",
    updatedAt: 0,
    order: 1,
  };
  withBlank(m, "b1");
  const { engine, calls } = setup(m);
  const sent: Record<string, string> = {};
  const run = async (
    name: string,
    action: Parameters<typeof act>[1],
    target = "step",
  ) => {
    const n = calls.length;
    const done = act(engine, action);
    await settled(calls, n + 1);
    sent[name] = calls[n].req.system;
    calls[n].release(
      `Ok.\n\`\`\`map\n{"ops":[{"op":"update","id":"${target}","detail":"d"}]}\n\`\`\``,
    );
    await done;
  };
  await run("fill", { type: "fill", blankId: "b1", text: "x" });
  await run("scene", { type: "scene", nodeId: "step" });
  await run("thread", { type: "thread", nodeId: "step", text: "why?" });
  m.nodes.root.detail = "";
  await run("explain", { type: "explain", nodeId: "root" }, "root");
  const has = (name: string, re: RegExp) => re.test(sent[name]);
  assert.ok(
    has("fill", /TOPIC DIAGRAM \(learning/) && !has("fill", /PLAYABLE SCENE/),
  );
  assert.ok(
    has("scene", /PLAYABLE SCENE/) && !has("scene", /TOPIC DIAGRAM \(learning/),
  );
  assert.ok(
    has("thread", /THREADS:/) &&
      !has("thread", /TOPIC DIAGRAM \(learning|PLAYABLE SCENE/),
  );
  assert.ok(
    has("explain", /EXPLAIN on a node/) &&
      !has("explain", /TOPIC DIAGRAM \(learning|PLAYABLE SCENE/),
  );
});

test("a right answer to a blank is checked instantly, with no model call", async () => {
  const m = newMap("Queens", "learn");
  m.nodes.root = {
    id: "root",
    parent: null,
    kind: "question",
    title: "Q",
    summary: "",
    detail: "",
    status: "open",
    by: "claude",
    updatedAt: 0,
    order: 0,
  };
  const { engine, calls } = setup(m);
  // the model draws a diagram whose blank carries its accepted answers
  const drawn = act(engine, {
    type: "message",
    text: "draw it",
    selection: [],
  });
  await settled(calls, 1);
  calls[0].release(
    'Here.\n```map\n{"ops":[{"op":"diagram","spec":{"form":"grid","title":"Q","columns":["r + c"],"rows":[{"label":"Row 1","cells":[{"id":"a1","blank":true,"prompt":"r + c?","accept":["4"],"why":"1 + 3 = 4"}]}]}}]}\n```',
  );
  await drawn;
  assert.doesNotMatch(
    JSON.stringify(engine.snapshot()),
    /"accept"|1 \+ 3 = 4/,
    "the browser never sees them",
  );

  assert.deepEqual(
    await act(engine, { type: "fill", blankId: "a1", text: " 4 " }),
    { ok: true },
  );
  assert.equal(calls.length, 1, "no model call for a right answer");
  assert.equal(m.fills.a1.state, "right");
  const cell =
    m.diagram?.form === "grid" ? m.diagram.rows[0].cells[0] : undefined;
  assert.equal(cell?.filled, true);
  assert.equal(m.chat.at(-1)?.text, "Right: 1 + 3 = 4");
  assert.equal(m.chat.at(-1)?.blankId, "a1");
});

test("an answer the blank does not accept still goes to the model", async () => {
  const m = newMap("Queens", "learn");
  m.diagram = {
    form: "grid",
    title: "Q",
    columns: ["x"],
    rows: [
      { label: "r", cells: [{ id: "a1", blank: true, prompt: "?", text: "" }] },
    ],
  };
  m.answers = { a1: { accept: ["4"], why: "" } };
  const { engine, calls } = setup(m);
  const done = act(engine, { type: "fill", blankId: "a1", text: "four-ish" });
  await settled(calls, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].req.message, /FILL: the learner wrote "four-ish"/);
  calls[0].release(
    'Not quite.\n```map\n{"ops":[{"op":"judge","id":"a1","state":"wrong"}]}\n```',
  );
  await done;
  assert.equal(m.fills.a1.state, "wrong");
});

// A Design map with a brief, the client, and Claude's hidden reference.
function designMap() {
  const m = newMap("Design Twitter", "design");
  m.data = {
    design: {
      ...newState(),
      brief: {
        title: "Design Twitter",
        goals: [],
        constraints: [],
        scale: [],
        reads: 300_000,
        writes: 6_000,
      },
      comps: [
        {
          id: "app",
          kind: "client",
          label: "Mobile app",
          x: 40,
          y: 220,
          count: 1,
          shards: 1,
          by: "claude",
        },
      ],
      reference: {
        comps: [{ id: "tweets", kind: "nosql", label: "Secret tweet store" }],
        wires: [],
        notes: ["Celebrities are merged in at read time"],
      },
    },
  };
  return m;
}
const design = (name: string, args: Record<string, unknown> = {}) =>
  ({ type: "plugin", plugin: "design", name, args }) as const;

test("a Design map's reference reaches the browser only once you reveal it", async () => {
  const { engine, calls, events } = setup(designMap());
  const secret = /Secret tweet store|Celebrities/;
  const viewOf = () => {
    const e = engine.snapshot();
    assert.ok(e.type === "map");
    return e.map?.data?.design as { reference: unknown };
  };
  assert.equal(viewOf().reference, null, "the browser view leaves it out");
  assert.doesNotMatch(JSON.stringify(engine.snapshot()), secret);

  // every snapshot pushed while you work leaves it out too, though the model sees it
  await act(engine, design("add", { kind: "cache", x: 300, y: 220 }));
  await act(engine, design("connect", { from: "app", to: "cache" }));
  const check = act(engine, design("check"));
  await settled(calls, 1);
  assert.match(calls[0].req.message, /REFERENCE DESIGN \(yours, hidden/);
  assert.match(calls[0].req.message, secret);
  calls[0].release(
    'Close.\n```map\n{"ops":[{"op":"review","summary":"Add a store.","points":[{"level":"fix","text":"Reads have nowhere to go.","on":["cache"]}]}]}\n```',
  );
  await check;
  assert.ok(events.length > 3);
  for (const e of events) assert.doesNotMatch(JSON.stringify(e), secret);

  assert.deepEqual(await act(engine, design("reveal")), { ok: true });
  assert.deepEqual(
    (viewOf().reference as { comps: { label: string }[] }).comps.map(
      (c) => c.label,
    ),
    ["Secret tweet store"],
  );
  assert.match(JSON.stringify(engine.snapshot()), /Celebrities/);
  assert.match(JSON.stringify(events.at(-1)), /Celebrities/, "and is pushed");
});

test("plugin actions are refused cleanly", async () => {
  const refused = { error: "That action is not available on this map." };
  const { engine } = setup(designMap());
  for (const req of [
    { type: "plugin", plugin: "nope", name: "add", args: {} },
    design("nope"),
    design("constructor"),
    design("__proto__"),
    design("toString"),
    design("hasOwnProperty"),
    { type: "plugin", plugin: "design" },
    { type: "plugin", plugin: "design", name: ["add"] },
    { type: "plugin" },
  ])
    assert.deepEqual(
      await act(engine, req as Parameters<typeof act>[1]),
      refused,
      JSON.stringify(req),
    );

  // a Design action while a Learn map is open
  const learn = setup(newMap("Hash maps", "learn"));
  assert.deepEqual(
    await act(learn.engine, design("add", { kind: "cache" })),
    refused,
  );
  assert.deepEqual(await act(learn.engine, design("constructor")), refused);
  assert.equal(learn.engine.state.map?.data, undefined, "no Design state made");
  // and on an Explore map, a plugin action with no plugin named is refused, not a crash
  const explore = setup(newMap("Which DB?", "explore"));
  assert.deepEqual(
    await act(explore.engine, { type: "plugin" } as Parameters<typeof act>[1]),
    refused,
  );
});

test("a mode switch accepts only Explore and Learn, and a Design map keeps its mode", async () => {
  const { engine } = setup(newMap("Which DB?", "explore"));
  for (const purpose of ["design", "__proto__", "decide"])
    assert.match(
      (await act(engine, { type: "purpose", purpose })).error ?? "",
      /only between Explore and Learn/,
    );
  assert.equal(engine.state.map?.purpose, "explore");
  const d = setup(designMap());
  assert.match(
    (await act(d.engine, { type: "purpose", purpose: "learn" })).error ?? "",
    /mode is fixed/,
  );
});

test("a second Check my design while one runs asks for no second review", async () => {
  const { engine, calls } = setup(designMap());
  const first = act(engine, design("check"));
  await settled(calls, 1);
  assert.deepEqual(await act(engine, design("check")), {});
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(engine.state.waiting.length, 0, "nothing queued behind it");
  calls[0].release("Looks thin.");
  await first;
  assert.equal(
    engine.state.map?.chat.filter((c) => c.text === "Check my design.").length,
    1,
  );
});

test("a Design map refuses the core actions its screen has no use for", async () => {
  const { engine, calls } = setup(designMap());
  const m = engine.state.map!;
  m.nodes.root = {
    id: "root",
    parent: null,
    kind: "question",
    title: "Design WhatsApp",
    summary: "",
    detail: "",
    status: "open",
    by: "claude",
    updatedAt: 0,
    order: 0,
  };
  m.nodes.dd = {
    id: "dd",
    parent: "root",
    kind: "question",
    title: "How is no message lost?",
    summary: "",
    detail: "",
    status: "open",
    by: "claude",
    updatedAt: 0,
    order: 0,
  };
  const chat = m.chat.length;
  for (const req of [
    { type: "next" },
    { type: "challenge", nodeId: "dd" },
    { type: "fill", blankId: "b1", text: "x" },
    { type: "scene", nodeId: "dd" },
    { type: "play", nodeId: "dd", key: "a" },
  ])
    assert.deepEqual(
      await act(engine, req as Parameters<typeof act>[1]),
      { error: "That action is not available on this map." },
      req.type,
    );
  // a hint or going deeper needs a deep dive that is there
  for (const req of [
    { type: "hint", nodeId: "nope" },
    { type: "hint", nodeId: "root" },
    { type: "deeper", nodeId: "nope" },
  ])
    assert.match(
      (await act(engine, req as Parameters<typeof act>[1])).error ?? "",
      /^No such/,
      `${req.type} ${req.nodeId}`,
    );
  await tick();
  assert.equal(calls.length, 0, "no model call");
  assert.equal(m.chat.length, chat, "nothing said");

  // a deep dive's own actions still work, and a hint's reply stays with it
  const hint = act(engine, { type: "hint", nodeId: "dd" });
  await settled(calls, 1);
  calls[0].release("Think about when Alice sees sent.");
  await hint;
  assert.equal(m.chat.at(-1)?.nodeId, "dd");
  // a request with no type is plainly invalid
  assert.deepEqual(await act(engine, {} as Parameters<typeof act>[1]), {
    error: "That request is not valid.",
  });
});

test("Undo on a Design map puts back a removed wire", async () => {
  const { engine } = setup(designMap());
  const s = () =>
    engine.state.map?.data?.design as {
      wires: { id: string; times: number }[];
    };
  await act(engine, design("add", { kind: "service", x: 300, y: 220 }));
  await act(engine, design("connect", { from: "app", to: "service" }));
  const id = s().wires[0].id;
  await act(engine, design("wire", { id, times: 10 }));
  await act(engine, design("unwire", { id }));
  assert.equal(s().wires.length, 0);
  assert.deepEqual(await act(engine, design("undo")), { ok: true });
  assert.deepEqual(
    s().wires.map((w) => [w.id, w.times]),
    [[id, 10]],
  );
  assert.match(
    (await act(engine, design("connect", { from: "app", to: "app" }))).error ??
      "",
    /itself/,
  );
  assert.match(
    (await act(engine, design("connect", { from: "app", to: "service" })))
      .error ?? "",
    /already wired/,
  );
});
