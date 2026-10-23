// A map linked to one of your conversations: the conversation is found on
// disk, the map opens again when asked twice, every move reads the
// conversation first, and the read-back holds only what the browser sees.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import type { ServerEvent } from "../shared/model.ts";
import type {
  ModelProvider,
  ModelReply,
  ModelRequest,
} from "./providers/types.ts";

// maps and conversations in a throwaway home, set before the store loads
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-link-"));
process.env.LIVING_MAP_HOME = path.join(tmp, "living-map");
// the conversation layer is still behind its flag (server/flags.ts)
process.env.LIVING_MAP_EXPERIMENTAL = "1";
const claude = path.join(tmp, "claude");
const cwd = path.join(tmp, "project");
fs.mkdirSync(cwd, { recursive: true });

const { findConversation, projectFolder } =
  await import("./providers/claude-sessions.ts");
const { createEngine } = await import("./engine.ts");
const { link, mapText } = await import("./actions/link.ts");
const { LINKED } = await import("./core/prompts.ts");

function conversation(id: string, lines: unknown[], at = Date.now()) {
  const dir = path.join(claude, "projects", projectFolder(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${id}.jsonl`);
  // Claude Code ends every line, the last one too
  fs.writeFileSync(f, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  fs.utimesSync(f, at / 1000, at / 1000);
  return f;
}
const said = (text: unknown) => ({
  type: "user",
  cwd,
  message: { role: "user", content: text },
});

conversation("older", [said("Something from last week")], Date.now() - 60_000);
conversation("abc-123", [
  said([
    { type: "text", text: "<system-reminder>not yours</system-reminder>" },
  ]),
  said("Should we move the API to Postgres or stay on Mongo?"),
  { type: "assistant", cwd, message: { role: "assistant", content: "Hm." } },
]);

const ROOT =
  'Laid out.\n```map\n{"ops":[\n{"op":"add","id":"q","parent":null,"kind":"question","title":"Which DB?"},\n{"op":"add","id":"pg","parent":"q","kind":"option","title":"Postgres"}\n]}\n```';

function setup() {
  const calls: ModelRequest[] = [];
  const provider: ModelProvider = {
    name: "scripted",
    models: [{ id: "", label: "Default" }],
    efforts: [{ id: "", label: "Default" }],
    findConversation: (hint) => findConversation(hint, claude),
    run(req, onText) {
      calls.push(req);
      onText(ROOT);
      const reply: ModelReply = {
        ok: true,
        final: ROOT,
        firstMs: 1,
        endMs: 2,
        usage: Promise.resolve(null),
      };
      return { reply: Promise.resolve(reply), cancel: () => {} };
    },
  };
  const events: ServerEvent[] = [];
  const engine = createEngine({
    provider,
    hub: { add: () => {}, remove: () => {}, emit: (e) => events.push(e) },
    initial: null,
    save: () => {},
  });
  return { engine, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test("a conversation is found by its id, or as the newest in its folder, titled by what you said first", () => {
  const byId = findConversation({ id: "older" }, claude);
  assert.equal(byId?.id, "older");
  assert.equal(byId?.cwd, cwd);
  const newest = findConversation({ cwd }, claude);
  assert.equal(newest?.id, "abc-123");
  assert.equal(
    newest?.title,
    "Should we move the API to Postgres or stay on Mongo?",
  );
  // an id the skill could not fill in falls back to the folder
  assert.equal(
    findConversation({ id: "${CLAUDE_SESSION_ID}", cwd }, claude)?.id,
    "abc-123",
  );
  assert.equal(findConversation({ id: "../etc" }, claude), null);
  assert.equal(findConversation({}, claude), null);
});

test("linking starts a map whose every move reads the conversation; asked again, the same map opens", async () => {
  const { engine, calls } = setup();
  const r = await link(engine, {
    session: "abc-123",
    question: "Postgres or Mongo for the API?",
  });
  assert.equal(r.created, true);
  await settle();
  assert.equal(calls.length, 1, "the first move runs at once");
  assert.equal(calls[0].conversation?.id, "abc-123");
  assert.ok(calls[0].system.endsWith(LINKED));
  const m = engine.state.map!;
  assert.equal(m.id, r.mapId);
  assert.deepEqual(engine.publicMap(m)?.linked, {
    title: "Should we move the API to Postgres or stay on Mongo?",
  });
  assert.equal(
    (engine.publicMap(m) as Record<string, unknown>).conversation,
    undefined,
    "where the conversation is kept stays on the server",
  );

  const again = await link(engine, { cwd, message: "We picked Postgres." });
  assert.equal(again.created, false);
  assert.equal(again.mapId, r.mapId);
  await settle();
  assert.equal(calls.length, 2, "the message is a move on the same map");
  assert.match(calls[1].message, /We picked Postgres\./);
  assert.equal(calls[1].conversation?.id, "abc-123");

  const text = mapText(engine, engine.state.map!);
  assert.match(text, /LIVING MAP: Postgres or Mongo for the API\?/);
  assert.match(text, /\[pg\] option/);
});

test("a conversation with no map is read first, then drawn in the view it needs; one that cannot be found says so", async () => {
  const { engine, calls } = setup();
  assert.match(
    (await link(engine, { session: "nope", question: "Q" })).error ?? "",
    /Could not find/,
  );
  assert.equal(calls.length, 0);
  const r = await link(engine, { session: "older" });
  assert.equal(r.created, true);
  await settle();
  // the layer's catch-up: only the new turns, not the resumed conversation
  assert.match(calls[0].system, /LIVE RAIL OF A CONVERSATION/);
  assert.equal(calls[0].conversation, undefined);
  assert.match(calls[0].message, /\[turn 1\] USER: Something from last week/);
  // then the view (Explore, with no other suggested) draws, reading it all
  assert.equal(engine.state.map?.purpose, "explore");
  assert.equal(calls[1].conversation?.id, "older");
  assert.ok(Object.keys(engine.state.map!.nodes).length > 0);
});

test("a linked map left empty is drawn again when it is linked again", async () => {
  const { engine, calls } = setup();
  const r = await link(engine, { session: "older", question: "Q?" });
  await settle();
  const m = engine.state.map!;
  m.nodes = {};
  await link(engine, { session: "older" });
  await settle();
  assert.equal(engine.state.map!.id, r.mapId);
  assert.equal(calls.length, 2, "its first move again");
  assert.ok(Object.keys(engine.state.map!.nodes).length);
});

test("a topic named in another mode starts its own map; the mode named alone switches the shared one", async () => {
  const { engine } = setup();
  const r = await link(engine, { session: "older", question: "Which DB?" });
  await settle();
  const learn = await link(engine, {
    session: "older",
    purpose: "learn",
    question: "How do database indexes work?",
  });
  assert.equal(learn.created, true);
  assert.notEqual(learn.mapId, r.mapId);
  assert.equal(engine.state.map!.purpose, "learn");
  assert.equal(engine.state.map!.conversation?.id, "older");
});

test("a first move that draws nothing is asked once more, without anyone waiting on it", async () => {
  const { engine, calls } = setup();
  let blank = 1;
  const run = engine.provider.run;
  engine.provider.run = (req, onText) => {
    if (blank-- > 0) {
      calls.push(req);
      const reply: ModelReply = {
        ok: true,
        final: "Nothing.",
        firstMs: 1,
        endMs: 2,
        usage: Promise.resolve(null),
      };
      return { reply: Promise.resolve(reply), cancel: () => {} };
    }
    return run(req, onText);
  };
  await link(engine, { session: "older", question: "Q?", new: true });
  await settle();
  assert.equal(calls.length, 2);
  assert.ok(Object.keys(engine.state.map!.nodes).length);
});

test("what you write on a view, and its answer, reach the main chat; switching views does not", async () => {
  const { engine } = setup();
  await link(engine, { session: "older", question: "Which DB?" });
  await settle();
  const { act } = await import("./actions/index.ts");
  const { unsentFor } = await import("../layer/view.ts");
  unsentFor("older"); // what came before is not this test's
  await act(engine, { type: "thread", nodeId: "pg", text: "Yes, go with it" });
  await act(engine, { type: "purpose", purpose: "learn" });
  const heard = unsentFor("older");
  assert.match(heard, /in the thread on "Postgres" on the Explore view/);
  assert.match(heard, /"Yes, go with it"/);
  assert.match(heard, /The map answered: Laid out\./);
  assert.doesNotMatch(heard, /Switched the canvas/);
  assert.equal(unsentFor("older"), "");
});

test("a listener in the main chat is woken by what you tell it on the map, not by a tick", async () => {
  const { engine } = setup();
  await link(engine, { session: "older", question: "Which DB?" });
  await settle();
  const { act } = await import("./actions/index.ts");
  const { unsentFor, wakesFor } = await import("../layer/view.ts");
  const { layerOf } = await import("../layer/store.ts");
  unsentFor("older");
  const s = layerOf(engine.state.map!.conversation!);
  s.items.k = {
    id: "k",
    parent: null,
    type: "task",
    state: "pending",
    owner: "you",
    title: "Run it",
    summary: "",
    updatedAt: 0,
    order: 0,
  };
  await act(engine, {
    type: "plugin",
    plugin: "follow",
    name: "mark",
    args: { id: "k", state: "done" },
  });
  // a tick waits for your next message
  assert.equal(wakesFor("older"), false);
  await act(engine, {
    type: "plugin",
    plugin: "follow",
    name: "tell",
    args: { text: "Go ahead and push" },
  });
  assert.equal(wakesFor("older"), true);
  const heard = unsentFor("older");
  assert.match(heard, /"Run it": the user marked it done/);
  assert.match(heard, /wrote to you from the map: "Go ahead and push"/);
  const view = engine.publicMap(engine.state.map)!.data!.follow as {
    told: { text: string; heard: boolean }[];
  };
  assert.deepEqual(
    view.told.map((t) => [t.text, t.heard]),
    [["Go ahead and push", true]],
  );
});
