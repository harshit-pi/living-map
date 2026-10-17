// Learn as a plugin: registered, and its prompts pinned word for word. The
// fixture is the text core sent before Learn was a plugin; a change to the
// prompts is a deliberate change to this fixture.

import assert from "node:assert/strict";
import { test } from "vitest";

import fixture from "./prompts.fixture.json" with { type: "json" };
import { learn } from "./server.ts";
import { systemPrompt } from "../../server/core/prompts.ts";
import { modeOf, pluginFor, PLUGINS } from "../../server/plugins.ts";

test("Learn is a registered plugin, and serves a map whose mode is not installed", () => {
  assert.equal(pluginFor("learn"), learn);
  assert.ok(PLUGINS.includes(learn));
  assert.deepEqual(learn.switchesWith, ["explore"]);
  assert.equal(modeOf("no-such-mode"), learn);
});

test("Learn's prompts are word for word what core sent before the move", () => {
  assert.equal(fixture.length, 3);
  for (const { sections, prompt } of fixture)
    assert.equal(systemPrompt("learn", sections, learn), prompt, `${sections}`);
});
