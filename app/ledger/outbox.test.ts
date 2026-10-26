// What the main chat hears from its map: posted under the chat's ids, found
// again by any of them, taken once, and waking the listener only when marked.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { heardAt, post, unsentFor, wakesFor } from "./outbox.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-outbox-"));

test("a message is heard once, by any id the chat has had", () => {
  const dir = tmp();
  post(["c1", "c2"], "Habits", "You answered: Monday", true, dir, 1000);
  assert.equal(wakesFor("c2", dir), true);
  assert.equal(unsentFor("c2", dir, 2000), "- You answered: Monday");
  assert.equal(unsentFor("c1", dir), "");
  assert.equal(wakesFor("c1", dir), false);
  assert.equal(heardAt(["c1"], dir), 2000);
});

test("a quiet message waits for the next message without waking the listener", () => {
  const dir = tmp();
  post(["q1"], "", "A side chat's finding was applied", false, dir);
  assert.equal(wakesFor("q1", dir), false);
  assert.match(unsentFor("q1", dir), /finding was applied/);
});

test("an unknown or malformed session hears nothing", () => {
  const dir = tmp();
  assert.equal(unsentFor("nobody", dir), "");
  assert.equal(wakesFor("../etc", dir), false);
});
