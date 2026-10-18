// Show me the answer on a build map: only after a first try, written into
// the step's thread and kept as its detail, credited as shown; the whole
// question's answer marks nothing built.

import assert from "node:assert/strict";
import { test } from "vitest";

import { ASK_FULL } from "./answer.ts";
import {
  buildMap,
  learnAct,
  reply,
  S,
  settled,
  setup,
  tick,
} from "./testkit.ts";
import { act } from "../../server/actions/index.ts";
import { ASK_ANSWER } from "../../shared/model.ts";

const CODE = "def maxSubArray(nums): ...";

function building() {
  const { m, s } = buildMap("some");
  s.steps.s1 = {
    stage: "build",
    help: 1,
    rungs: { built: null, why: null, whatif: null, case: null, kept: null },
  };
  return setup(m);
}

test("a step's answer: refused before a first try, then written in its thread and credited as shown", async () => {
  const { engine, calls } = building();
  const before = await act(engine, learnAct("answerStep", { step: "s1" }));
  assert.match(before.error ?? "", /first/);
  assert.equal(calls.length, 0, "a refusal costs no model call");

  await act(engine, learnAct("check", { step: "s1" }));
  assert.equal(calls.length, 0, "a check is free");

  const asked = act(engine, learnAct("answerStep", { step: "s1" }));
  // a second press while it runs is dropped
  const again = act(engine, learnAct("answerStep", { step: "s1" }));
  await settled(calls, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].req.message, /SHOW ANSWER on step \[s1\]/);
  calls[0].release(
    reply([{ op: "update", id: "s1", detail: CODE }], "Here is the code."),
  );
  const r = await asked;
  await again;
  await tick();

  const m = engine.state.map!;
  assert.ok(r.threadId, "the answer is in a thread");
  const thread = m.threads[r.threadId!];
  assert.equal(thread.nodeId, "s1");
  assert.equal(thread.messages[0].text, ASK_ANSWER);
  assert.ok(thread.messages.some((x) => /Here is the code/.test(x.text)));
  assert.equal(m.nodes.s1.detail, CODE);
  assert.equal(m.nodes.s1.revealed, true, "shown, never earned");
  assert.equal(S(m).steps.s1.viaModel, true, "a later build counts as shown");
  assert.equal(S(m).steps.s1.rungs.built, null, "and it is not built by this");
});

test("a step's answer that never arrives: one second try, then an error", async () => {
  const { engine, calls } = building();
  await act(engine, learnAct("check", { step: "s1" }));
  const asked = act(engine, learnAct("answerStep", { step: "s1" }));
  await settled(calls, 1);
  calls[0].release("No map block.");
  await settled(calls, 2);
  assert.match(calls[1].req.message, /did not deliver it/);
  calls[1].release("Still nothing.");
  const r = await asked;
  assert.match(r.error ?? "", /did not write it/);
  const m = engine.state.map!;
  assert.notEqual(m.nodes.s1.revealed, true, "nothing shown, nothing marked");
  assert.notEqual(S(m).steps.s1.viaModel, true);
});

test("the full answer: any time, in the question's thread, and nothing is marked built", async () => {
  const { engine, calls } = building();
  const asked = act(engine, learnAct("fullAnswer"));
  await settled(calls, 1);
  assert.match(calls[0].req.message, /FULL ANSWER to the map's question/);
  calls[0].release(
    reply([{ op: "update", id: "root", detail: CODE }], "The whole answer."),
  );
  const r = await asked;
  const m = engine.state.map!;
  assert.equal(m.threads[r.threadId!].nodeId, "root");
  assert.equal(m.threads[r.threadId!].messages[0].text, ASK_FULL);
  assert.equal(m.nodes.root.detail, CODE);
  for (const step of ["s1", "s2", "s3"]) {
    assert.notEqual(m.nodes[step].revealed, true);
    assert.equal(S(m).steps[step]?.rungs.built ?? null, null);
  }
});
