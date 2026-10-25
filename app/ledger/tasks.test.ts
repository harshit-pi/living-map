// Claude's task list replayed from its calls: whole lists replace, deltas
// apply by position, a wrap-up ticks everything off, and the Task tools go by
// the numbers they were made with.

import assert from "node:assert/strict";
import { test } from "vitest";

import { planOf } from "./tasks.ts";
import type { Entry } from "./transcript.ts";

let n = 0;
const call = (tool: string, input: unknown): Entry => ({
  uuid: `u${++n}`,
  seq: n,
  parent: null,
  logicalParent: null,
  type: "assistant",
  kind: "assistant",
  ts: n,
  plan: [{ tool, input }],
});
const plan = (input: unknown) => call("mcp__ccd_turn__update_plan", input);

test("the desktop app's plan: a whole list, then advance, done and start", () => {
  const items = [
    { content: "Read the code", status: "in_progress" },
    { content: "Fix the bug", status: "pending" },
    { content: "Run the tests", status: "pending" },
  ];
  assert.equal(planOf([plan({ items })]).doing, "Read the code");
  assert.equal(
    planOf([plan({ items }), plan({ advance: true })]).doing,
    "Fix the bug",
  );
  const p = planOf([plan({ items }), plan({ done: [1, 2], start: 3 })]);
  assert.equal(p.doing, "Run the tests");
  assert.deepEqual(
    p.steps.map((s) => s.status),
    ["done", "done", "doing"],
  );
});

test("a wrap-up ticks off what is left, so nothing shows as in progress", () => {
  const p = planOf([
    plan({ items: [{ content: "Ship it", status: "in_progress" }] }),
    call("mcp__ccd_turn__wrap_up", { recap: "done" }),
  ]);
  assert.equal(p.doing, null);
  assert.deepEqual(
    p.steps.map((s) => s.status),
    ["done"],
  );
});

test("TodoWrite replaces the list, and its in-progress wording is shown", () => {
  const p = planOf([
    call("TodoWrite", {
      todos: [
        {
          content: "Add tests",
          activeForm: "Adding tests",
          status: "in_progress",
        },
        { content: "Commit", activeForm: "Committing", status: "pending" },
      ],
    }),
  ]);
  assert.equal(p.doing, "Adding tests");
});

test("the Task tools go by the numbers tasks were made with", () => {
  const p = planOf([
    call("TaskCreate", { subject: "Write the store" }),
    call("TaskCreate", { subject: "Wire the routes" }),
    call("TaskUpdate", { taskId: "2", status: "in_progress" }),
    call("TaskUpdate", { taskId: "1", status: "completed" }),
  ]);
  assert.equal(p.doing, "Wire the routes");
  assert.deepEqual(
    p.steps.map((s) => s.status),
    ["done", "doing"],
  );
});

test("no task calls: no plan, so the map's own guess stands in", () => {
  assert.deepEqual(planOf([]), { steps: [], doing: null });
});
