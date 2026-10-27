// The transcript adapter on synthetic transcripts in the shapes Claude Code
// writes: duplicates, partial and bad lines, compaction, queued prompts and
// notices, hook context, slash commands, sealing, rewinds, tool results with
// patches, and reading in chunks giving what one read gives.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import {
  emptyTranscript,
  ingest,
  readMore,
  SEAL_IDLE_MS,
  view,
  type Transcript,
} from "./transcript.ts";

// ---- fixtures in the observed shapes -------------------------------------------

let clock = Date.parse("2026-01-01T00:00:00Z");
const at = () => new Date((clock += 1000)).toISOString();
const base = (type: string, uuid: string, parentUuid: string | null) => ({
  parentUuid,
  isSidechain: false,
  type,
  uuid,
  timestamp: at(),
  sessionId: "s1",
  version: "2.1.300",
});

const user = (
  uuid: string,
  parent: string | null,
  content: unknown,
  extra: object = {},
) => ({
  ...base("user", uuid, parent),
  message: { role: "user", content },
  ...extra,
});
const typed = (uuid: string, parent: string | null, text: string) =>
  user(uuid, parent, text, { origin: { kind: "human" }, promptSource: "sdk" });
const claude = (
  uuid: string,
  parent: string | null,
  text: string,
  stop = "end_turn",
) => ({
  ...base("assistant", uuid, parent),
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: stop,
  },
});
const call = (uuid: string, parent: string, id: string, name: string) => ({
  ...base("assistant", uuid, parent),
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input: {} }],
    stop_reason: "tool_use",
  },
});
const result = (
  uuid: string,
  parent: string,
  id: string,
  toolUseResult: unknown,
) =>
  user(
    uuid,
    parent,
    [{ tool_use_id: id, type: "tool_result", content: "TOOL OUTPUT TEXT" }],
    { toolUseResult, sourceToolAssistantUUID: parent },
  );
const attachment = (uuid: string, parent: string, a: object) => ({
  ...base("attachment", uuid, parent),
  attachment: a,
});
const compact = (uuid: string, logical: string) => ({
  ...base("system", uuid, null),
  logicalParentUuid: logical,
  subtype: "compact_boundary",
  content: "Conversation compacted",
  compactMetadata: { trigger: "auto", preTokens: 900000 },
});
const summary = (uuid: string, parent: string) =>
  user(uuid, parent, "This session is being continued from a previous …", {
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
  });
const stopHook = (uuid: string, parent: string) => ({
  ...base("system", uuid, parent),
  subtype: "stop_hook_summary",
  hookCount: 1,
});

const jsonl = (rows: object[]) =>
  rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const read = (rows: object[] | string) => {
  const t = emptyTranscript();
  ingest(t, typeof rows === "string" ? rows : jsonl(rows));
  return t;
};
const prompts = (t: Transcript) =>
  view(t, 0).turns.map((tn) => `${tn.via}:${tn.text}`);

// ---- files ------------------------------------------------------------------------

const dirs: string[] = [];
const tmpFile = (text = "") => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-"));
  dirs.push(dir);
  const f = path.join(dir, "s1.jsonl");
  fs.writeFileSync(f, text);
  return f;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true });
});

// ---- tests ------------------------------------------------------------------------

test("each uuid is kept once, the first copy winning, with no cap", () => {
  const rows: object[] = [typed("p1", null, "hello"), claude("c1", "p1", "hi")];
  let prev = "c1";
  for (let i = 0; i < 6000; i++) {
    rows.push(attachment(`a${i}`, prev, { type: "total_tokens_reminder" }));
    prev = `a${i}`;
  }
  // a resumed chat writes the history again, a parent relinked
  const again = rows.map((r) =>
    (r as { uuid: string }).uuid === "c1" ? { ...r, parentUuid: "x" } : r,
  );
  const t = read([...rows, ...again]);
  assert.equal(t.entries.length, 6002);
  assert.equal(t.duplicates, 6002);
  assert.equal(t.byId.get("c1")?.parent, "p1");
  assert.deepEqual(prompts(t), ["typed:hello"]);
});

test("a partial last line waits until it is whole", async () => {
  const whole = jsonl([typed("p1", null, "first"), claude("c1", "p1", "ok")]);
  const next = JSON.stringify(typed("p2", "c1", "second")) + "\n";
  const f = tmpFile(whole + next.slice(0, 20));
  const t = emptyTranscript();
  await readMore(t, f);
  assert.equal(t.entries.length, 2);
  assert.equal(t.offset, Buffer.byteLength(whole));
  fs.appendFileSync(f, next.slice(20));
  const { added } = await readMore(t, f);
  assert.equal(added, 1);
  assert.deepEqual(prompts(t), ["typed:first", "typed:second"]);
});

test("a bad line is counted and skipped", () => {
  const text =
    jsonl([typed("p1", null, "one")]) +
    '{"type":"assistant","uuid":"broken' +
    "\n" +
    jsonl([claude("c1", "p1", "two"), typed("p2", "c1", "three")]);
  const t = read(text);
  assert.equal(t.bad, 1);
  assert.equal(t.entries.length, 3);
  assert.deepEqual(prompts(t), ["typed:one", "typed:three"]);
});

test("a compaction is walked through, and its summary is not a prompt", () => {
  const t = read([
    typed("p1", null, "before"),
    claude("c1", "p1", "answer"),
    compact("b1", "c1"),
    summary("s1", "b1"),
    attachment("a1", "s1", { type: "session_context" }),
    typed("p2", "a1", "after"),
    claude("c2", "p2", "done"),
  ]);
  const v = view(t, 0);
  assert.equal(v.path[0].uuid, "p1");
  assert.equal(v.path.length, 7);
  assert.equal(v.compactions, 1);
  assert.deepEqual(v.abandoned, []);
  assert.deepEqual(prompts(t), ["typed:before", "typed:after"]);
});

test("a link to an entry never written continues from the one before", () => {
  // an auto-compaction names the message it interrupted, which was never written
  const t = read([
    typed("p1", null, "before"),
    claude("c1", "p1", "working", "tool_use"),
    compact("b1", "never-written"),
    summary("s1", "b1"),
    typed("p2", "s1", "after"),
  ]);
  const v = view(t, 0);
  assert.equal(v.path[0].uuid, "p1");
  assert.deepEqual(v.abandoned, []);
  assert.equal(v.turns.length, 2);
});

test("queued prompts count; task notifications and agent messages do not", () => {
  const t = read([
    typed("p1", null, "start the build"),
    call("c1", "p1", "t1", "Bash"),
    attachment("q1", "c1", {
      type: "queued_command",
      prompt: "also run the tests",
      commandMode: "prompt",
      origin: { kind: "human" },
      humanTurn: true,
    }),
    attachment("q2", "q1", {
      type: "queued_command",
      prompt: "<task-notification>\n<task-id>b1</task-id>…",
      commandMode: "task-notification",
      origin: { kind: "task-notification", producer: "session-task" },
    }),
    attachment("q3", "q2", {
      type: "queued_command",
      prompt: '<agent-message from="a1">\n[Subagent hand-back] …',
      commandMode: "prompt",
      origin: { kind: "peer", from: "a1", handback: true },
      isMeta: true,
    }),
    // an older Claude Code writes no origin
    attachment("q4", "q3", {
      type: "queued_command",
      prompt: [{ type: "text", text: "and lint" }],
      commandMode: "prompt",
    }),
    attachment("q5", "q4", {
      type: "queued_command",
      prompt: "<task-notification>\n<task-id>b2</task-id>…",
      commandMode: "prompt",
    }),
    user("n1", "q5", "<task-notification>\n<task-id>b3</task-id>…", {
      origin: { kind: "task-notification" },
      promptSource: "system",
    }),
    user("n2", "n1", "Another Claude session sent a message: …", {
      origin: { kind: "peer" },
      isMeta: true,
    }),
    user("n3", "n2", "<task-notification>\n<task-id>b4</task-id>…"),
    claude("c2", "n3", "all done"),
  ]);
  assert.deepEqual(prompts(t), [
    "typed:start the build",
    "queued:also run the tests",
    "queued:and lint",
  ]);
  // what Claude said after a notification stays in the turn it belongs to
  assert.equal(view(t, 0).turns[2].reply, "all done");
});

test("hook context is flagged on its turn, never a prompt", () => {
  const t = read([
    typed("p1", null, "what is pending?"),
    attachment("h1", "p1", {
      type: "hook_additional_context",
      content: ["LIVING MAP: 2 questions wait on you"],
      hookName: "UserPromptSubmit",
      hookEvent: "UserPromptSubmit",
    }),
    claude("c1", "h1", "Two questions."),
  ]);
  const v = view(t, 0);
  assert.equal(v.turns.length, 1);
  assert.deepEqual(v.turns[0].hooks, ["h1"]);
  const h = t.byId.get("h1");
  assert.equal(h?.kind, "hook");
  assert.equal(h?.hookEvent, "UserPromptSubmit");
  assert.equal(h?.text, "LIVING MAP: 2 questions wait on you");
});

test("slash commands count when Claude acts on them, not when run locally", () => {
  const t = read([
    // a skill: yours, followed by its expansion
    user(
      "k1",
      null,
      "<command-message>idea-gauntlet</command-message>\n<command-name>/idea-gauntlet</command-name>\n<command-args>a map app</command-args>",
      { origin: { kind: "human" } },
    ),
    user(
      "k1x",
      "k1",
      [{ type: "text", text: "Base directory for this skill…" }],
      {
        isMeta: true,
      },
    ),
    claude("c1", "k1x", "Verdict: build"),
    // a built-in run locally
    user(
      "m1",
      "c1",
      "<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>opus</command-args>",
    ),
    user(
      "m1o",
      "m1",
      "<local-command-stdout>Set model to opus</local-command-stdout>",
    ),
    // a custom command from an older Claude Code: no origin, then its expansion
    user(
      "x1",
      "m1o",
      "<command-name>/map</command-name>\n            <command-message>map</command-message>\n            <command-args></command-args>",
    ),
    user("x1x", "x1", "Open the map…", { isMeta: true }),
    claude("c2", "x1x", "Opened"),
    // `!` input, an interruption and a reminder alone are not prompts
    user("b1", "c2", "<bash-input>ls</bash-input>", {
      origin: { kind: "human" },
    }),
    user(
      "b1o",
      "b1",
      "<bash-stdout>a b</bash-stdout><bash-stderr></bash-stderr>",
    ),
    user("i1", "b1o", [
      { type: "text", text: "[Request interrupted by user]" },
    ]),
    user("r1", "i1", "<system-reminder>The date changed.</system-reminder>"),
    // just typed, nothing after it yet: not counted until the next line says
    user(
      "z1",
      "r1",
      "<command-name>/compact</command-name>\n            <command-message>compact</command-message>",
    ),
  ]);
  assert.deepEqual(prompts(t), [
    "command:/idea-gauntlet a map app",
    "command:/map",
  ]);
  assert.equal(t.byId.get("b1")?.kind, "shell");
  assert.equal(t.byId.get("b1")?.text, "ls");
  assert.equal(t.byId.get("i1")?.kind, "interrupt");
  assert.equal(t.byId.get("r1")?.kind, "meta");
});

test("a turn is sealed by a later prompt, or by end_turn and 2 s of quiet", () => {
  const one = [typed("p1", null, "q1"), claude("c1", "p1", "a1")];
  const t1 = read(one);
  assert.equal(view(t1, SEAL_IDLE_MS - 1).sealed, 0);
  assert.equal(view(t1, SEAL_IDLE_MS).sealed, 1);

  // bookkeeping after the reply does not reopen it
  const t2 = read([
    ...one,
    attachment("e1", "c1", { type: "hook_non_blocking_error" }),
    stopHook("s1", "e1"),
    { type: "last-prompt", lastPrompt: "q1", leafUuid: "s1", sessionId: "s1" },
  ]);
  assert.equal(view(t2, 60_000).sealed, 1);

  // still working: a tool call, or a notification Claude will answer
  const t3 = read([typed("p1", null, "q1"), call("c1", "p1", "t1", "Bash")]);
  assert.equal(view(t3, 60_000).sealed, 0);
  const t4 = read([
    ...one,
    user("n1", "c1", "<task-notification>…", {
      origin: { kind: "task-notification" },
    }),
  ]);
  assert.equal(view(t4, 60_000).sealed, 0);

  // a later prompt seals the one before at once, whatever the clock
  const t5 = read([...one, typed("p2", "c1", "q2")]);
  assert.equal(view(t5, 0).sealed, 1);
  assert.equal(view(t5, 0).turns.length, 2);
});

test("a rewind leaves an abandoned branch; parallel results are not one", () => {
  const t = read([
    typed("p1", null, "first"),
    claude("c1", "p1", "one"),
    typed("p2", "c1", "second, abandoned"),
    claude("c2", "p2", "two"),
    // rewound to c1 and asked again
    typed("p3", "c1", "second, again"),
    // two tool calls in one reply: each result hangs off the block that made it
    call("u1", "p3", "t1", "Edit"),
    call("u2", "u1", "t2", "Edit"),
    result("r1", "u1", "t1", {
      filePath: "/repo/a.ts",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-a", "+A"],
        },
      ],
      originalFile: "a\n",
    }),
    result("r2", "u2", "t2", {
      filePath: "/repo/b.ts",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-b", "+B"],
        },
      ],
      originalFile: "b\n",
    }),
    claude("c3", "r2", "both edited"),
  ]);
  const v = view(t, 0);
  assert.deepEqual(
    v.abandoned.map((e) => e.uuid),
    ["p2", "c2"],
  );
  assert.deepEqual(prompts(t), ["typed:first", "typed:second, again"]);
  assert.deepEqual(
    v.turns[1].changes.map((c) => c.filePath),
    ["/repo/a.ts", "/repo/b.ts"],
  );
  assert.ok(v.turns[1].entries.includes("r1"));
});

test("tool results keep patches for what changed, never tool output", () => {
  const t = read([
    typed("p0", null, "set up"),
    call("u0", "p0", "t0", "Write"),
    result("r0", "u0", "t0", {
      type: "create",
      filePath: "/repo/new.ts",
      content: "export const x = 1;\n",
      structuredPatch: [],
      originalFile: null,
    }),
    typed("p1", "r0", "fix it"),
    call("u1", "p1", "t1", "Edit"),
    result("r1", "u1", "t1", {
      filePath: "/repo/new.ts",
      oldString: "1",
      newString: "2",
      originalFile: "export const x = 1;\n",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-export const x = 1;", "+export const x = 2;"],
        },
      ],
      userModified: false,
    }),
    call("u2", "r1", "t2", "Bash"),
    result("r2", "u2", "t2", {
      stdout: "TOOL STDOUT",
      stderr: "",
      interrupted: false,
      bashEditDiff: {
        files: [
          {
            filePath: "/repo/c.json",
            hunks: [
              {
                oldStart: 2,
                oldLines: 1,
                newStart: 2,
                newLines: 1,
                lines: ["-1", "+2"],
              },
            ],
          },
        ],
      },
    }),
    call("u3", "r2", "t3", "Read"),
    result("r3", "u3", "t3", { type: "text", file: { content: "FILE TEXT" } }),
    claude("c1", "r3", "Fixed."),
  ]);
  const v = view(t, 0);
  assert.deepEqual(
    v.changes.map((c) => [c.turn, c.tool, c.toolUseId, c.filePath ?? null]),
    [
      [1, "Write", "t0", "/repo/new.ts"],
      [2, "Edit", "t1", "/repo/new.ts"],
      [2, "Bash", "t2", null],
    ],
  );
  assert.equal(v.changes[0].content, "export const x = 1;\n");
  assert.equal(v.changes[0].originalFile, null);
  assert.equal(v.changes[1].originalFile, "export const x = 1;\n");
  assert.equal(v.changes[2].bashEditDiff?.files[0].filePath, "/repo/c.json");
  assert.equal(v.turns[1].reply, "Fixed.");
  const kept = JSON.stringify(t.entries);
  for (const s of ["TOOL OUTPUT TEXT", "TOOL STDOUT", "FILE TEXT", "oldString"])
    assert.ok(!kept.includes(s), s);
});

test("reading in small chunks, or as the file grows, gives what one read gives", async () => {
  // longer than every chunk size below, short enough that 7-byte reads stay
  // fast when the whole suite runs at once
  const long = "x".repeat(5_000);
  const rows = [
    typed("p1", null, "hello"),
    claude("c1", "p1", `long ${long}`),
    attachment("q1", "c1", {
      type: "queued_command",
      prompt: "queued ✓ ünïcode",
      commandMode: "prompt",
      origin: { kind: "human" },
    }),
    compact("b1", "q1"),
    summary("s1", "b1"),
    typed("p2", "s1", "after"),
    claude("c2", "p2", "done"),
  ];
  const text = jsonl([...rows, ...rows.slice(0, 3)]) + "not json\n";
  const f = tmpFile(text);
  const once = emptyTranscript();
  await readMore(once, f);

  const small = emptyTranscript();
  await readMore(small, f, 7);
  assert.deepEqual(small, once);

  // the file written a few bytes at a time, read after every write
  const g = tmpFile();
  const growing = emptyTranscript();
  const bytes = Buffer.from(text);
  for (let i = 0; i < bytes.length; i += 4093) {
    fs.appendFileSync(g, bytes.subarray(i, i + 4093));
    await readMore(growing, g, 1000);
  }
  assert.deepEqual(growing, once);
  assert.equal(once.duplicates, 3);
  assert.equal(once.bad, 1);
  assert.deepEqual(view(growing, 0).turns, view(once, 0).turns);
  assert.deepEqual(prompts(once), [
    "typed:hello",
    "queued:queued ✓ ünïcode",
    "typed:after",
  ]);
});

test("a file shorter than what was read is read again from the start", async () => {
  const f = tmpFile(jsonl([typed("p1", null, "one"), claude("c1", "p1", "a")]));
  const t = emptyTranscript();
  await readMore(t, f);
  fs.writeFileSync(f, jsonl([typed("p9", null, "new")]));
  const { reset } = await readMore(t, f);
  assert.equal(reset, true);
  assert.deepEqual(prompts(t), ["typed:new"]);
});
