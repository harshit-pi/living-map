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
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n"));
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

test("a conversation with no map needs a question; one that cannot be found says so", async () => {
  const { engine, calls } = setup();
  assert.match(
    (await link(engine, { session: "older" })).error ?? "",
    /pass `question`/,
  );
  assert.match(
    (await link(engine, { session: "nope", question: "Q" })).error ?? "",
    /Could not find/,
  );
  assert.equal(calls.length, 0);
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
