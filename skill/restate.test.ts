// Something from the map is said back in Claude's own reply, so it lands in
// the chat's transcript: the listener's output and the hook's note both ask
// for that, the same way.

import assert from "node:assert/strict";
import { test } from "vitest";

import { fromMap, mapNote, RESTATE } from "./restate.ts";

const answer = 'On the map, the user answered "Which store?": Postgres';

test("the listener prints the map's words, then asks for them back in the reply", () => {
  const out = fromMap(answer);
  assert.ok(out.startsWith(`FROM YOUR LIVING MAP:\n${answer}\n`));
  assert.ok(out.endsWith(RESTATE));
});

test("the hook's note asks the same, after the map's words", () => {
  const note = mapNote(answer, 4317);
  assert.match(note, /^LIVING MAP: .*localhost:4317/);
  assert.ok(note.includes(answer));
  assert.ok(note.endsWith(RESTATE));
});

test("the request names the line to write and says why", () => {
  assert.match(RESTATE, /"From your map:"/);
  assert.match(RESTATE, /not part of this chat's transcript/);
});
