import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  batchEnd,
  BATCH_TURNS,
  canvasOf,
  cleanItemOp,
  cleanUserText,
  contextPage,
  digest,
  newState,
  post,
  readTurns,
  setTask,
  shouldFollow,
  takeUnsent,
} from "./core.ts";
import { chatState, readNew } from "./follow.ts";
import { chat } from "./server.ts";
import type { Turn } from "./shared.ts";
import { applyOps, makeNode } from "../../server/core/canvas.ts";
import type { Raw } from "../../server/core/types.ts";
import { successor } from "../../server/providers/claude-sessions.ts";
import { newMap } from "../../server/store.ts";
import { hookCommand, installHook } from "../../skill/install.ts";

const line = (o: object) => JSON.stringify(o);
const you = (uuid: string, content: unknown, extra = {}) =>
  line({
    type: "user",
    uuid,
    timestamp: "2026-10-22T10:00:00Z",
    message: { role: "user", content },
    ...extra,
  });
const claude = (uuid: string, content: unknown) =>
  line({
    type: "assistant",
    uuid,
    timestamp: "2026-10-22T10:00:05Z",
    message: { role: "assistant", content },
  });

describe("reading a transcript", () => {
  it("keeps what you said, without what the app wraps around it", () => {
    expect(
      cleanUserText(
        "<system-reminder>\nbig reminder\n</system-reminder>\nclaude --teleport abc",
      ),
    ).toBe("claude --teleport abc");
    expect(
      cleanUserText(
        "<bash-input>ls</bash-input><bash-stdout>a\nb</bash-stdout><bash-stderr></bash-stderr>",
      ),
    ).toBe("Ran in the terminal: ls");
    expect(
      cleanUserText(
        "<command-message>living-map</command-message>\n<command-name>/living-map</command-name>",
      ),
    ).toBe("/living-map");
    expect(
      cleanUserText(
        '\n<pasted_content id="34f9">\nfix the map\n</pasted_content id="34f9">\n\nand track tasks',
      ),
    ).toBe("(pasted)\nfix the map\n(end of paste)\n\nand track tasks");
    expect(
      cleanUserText(
        "<side-sessions-event>a session ended</side-sessions-event>",
      ),
    ).toBe("");
  });

  it("turns lines into turns: a reply runs until you write again", () => {
    const turns: Turn[] = [];
    const seen = new Set<string>();
    const added = readTurns(
      [
        you("u1", "install the skill"),
        claude("a1", [
          { type: "thinking", thinking: "…" },
          { type: "text", text: "Reading the installer." },
        ]),
        claude("a2", [{ type: "tool_use", id: "t", name: "Bash", input: {} }]),
        you("u2", [{ type: "tool_result", tool_use_id: "t", content: "ok" }]),
        claude("a3", [{ type: "text", text: "Installed." }]),
        you("m1", "Base directory for this skill", { isMeta: true }),
        you("s1", "a subagent's prompt", { isSidechain: true }),
        "not json",
        you("u3", [{ type: "text", text: "now map it" }]),
      ],
      turns,
      seen,
    );
    expect(added).toBe(3);
    expect(turns.map((t) => [t.n, t.who, t.text])).toEqual([
      [1, "you", "install the skill"],
      [1, "claude", "Reading the installer.\n\nInstalled."],
      [2, "you", "now map it"],
    ]);
    // read again (the conversation moved to another file): nothing repeats
    expect(readTurns([you("u3", "now map it")], turns, seen)).toBe(0);
  });
});

describe("following", () => {
  const at = (
    s: ReturnType<typeof newState>,
    turns: Turn[],
    activeAt: number,
  ) => {
    s.turns = turns;
    s.activeAt = activeAt;
    return s;
  };
  const t = (n: number, who: Turn["who"], ts: number): Turn => ({
    n,
    who,
    text: `${who} ${n}`,
    ts,
  });

  it("catches up soon after you write, later after Claude's reply", () => {
    const now = 100_000;
    expect(
      shouldFollow(at(newState(), [t(1, "you", now)], now - 3000), now),
    ).toBe(true);
    expect(
      shouldFollow(at(newState(), [t(1, "you", now)], now - 1000), now),
    ).toBe(false);
    const reply = at(newState(), [t(1, "claude", now - 5000)], now - 5000);
    reply.mapped = 0;
    expect(shouldFollow(reply, now)).toBe(false);
    reply.activeAt = now - 9000;
    expect(shouldFollow(reply, now)).toBe(true);
    // a long reply still being written is caught up with now and then
    const long = at(newState(), [t(1, "claude", now - 95_000)], now - 3000);
    expect(shouldFollow(long, now)).toBe(true);
  });

  it("does nothing paused or with nothing new", () => {
    const s = at(newState(), [t(1, "you", 0)], 0);
    s.following = false;
    expect(shouldFollow(s, 100_000)).toBe(false);
    s.following = true;
    s.mapped = 1;
    expect(shouldFollow(s, 100_000)).toBe(false);
  });

  it("sends the new turns, and the one they answer", () => {
    const s = newState();
    s.turns = [t(1, "you", 0), t(1, "claude", 0), t(2, "you", 0)];
    s.mapped = 2;
    s.upTo = 3;
    const d = digest(s);
    expect(d).toContain("[turn 1] CLAUDE (already mapped): claude 1");
    expect(d).toContain("[turn 2] USER: you 2");
    expect(d).not.toContain("you 1");
  });
});

describe("items", () => {
  const mapWithRoot = () => {
    const m = newMap("Teleport", "chat");
    makeNode(m.nodes, { id: "root", parent: null, kind: "fact", title: "c" });
    return m;
  };

  it("files the model's ops with their type and state", () => {
    const m = mapWithRoot();
    const s = newState();
    const ops = [
      {
        op: "add",
        id: "setup",
        parent: "root",
        type: "topic",
        title: "Setup",
        turn: 1,
      },
      {
        op: "add",
        id: "skill",
        parent: "setup",
        type: "task",
        state: "pending",
        title: "Install skill",
        turn: 5,
      },
      {
        op: "add",
        id: "why",
        parent: "setup",
        type: "question",
        title: "Why weird?",
      },
      { op: "add", id: "root", parent: null, type: "topic", title: "no" },
    ];
    applyOps(m, ops, { clean: (op) => cleanItemOp(s, op) });
    expect(m.nodes.skill.kind).toBe("question");
    expect(m.nodes.skill.status).toBe("open");
    expect(s.items.skill).toEqual({ type: "task", state: "pending", turn: 5 });
    expect(s.items.why.state).toBe("open");
    expect(m.nodes.root.title).toBe("c");
    expect(canvasOf(m, s)).toContain(
      "- [skill] task · pending · turn 5 · Install skill",
    );

    applyOps(m, [{ op: "update", id: "skill", state: "done" }], {
      clean: (op) => cleanItemOp(s, op),
    });
    expect(s.items.skill.state).toBe("done");
    expect(m.nodes.skill.status).toBe("answered");
    // a question answered may become a decision
    applyOps(m, [{ op: "update", id: "why", type: "decision" }], {
      clean: (op) => cleanItemOp(s, op, m.nodes),
    });
    expect(s.items.why).toEqual({ type: "decision", turn: undefined });
    expect(m.nodes.why.status).toBe("chosen");
  });

  it("files what hangs from the conversation as a topic", () => {
    const m = mapWithRoot();
    const s = newState();
    applyOps(
      m,
      [
        { op: "add", id: "a", parent: "root", type: "task", title: "A" },
        { op: "add", id: "b", type: "question", title: "B?" },
        { op: "add", id: "c", parent: "a", type: "task", title: "C" },
      ],
      { clean: (op) => cleanItemOp(s, op, m.nodes) },
    );
    expect([s.items.a.type, s.items.b.type, s.items.c.type]).toEqual([
      "topic",
      "topic",
      "task",
    ]);
  });

  it("keeps your tick over the model's", () => {
    const m = mapWithRoot();
    const s = newState();
    applyOps(
      m,
      [
        { op: "add", id: "t", parent: "root", type: "topic", title: "T" },
        { op: "add", id: "k", parent: "t", type: "task", title: "Do it" },
      ],
      { clean: (op) => cleanItemOp(s, op) },
    );
    expect(setTask(s, m.nodes, "k", "done")?.status).toBe("answered");
    applyOps(m, [{ op: "update", id: "k", state: "pending" }], {
      clean: (op) => cleanItemOp(s, op),
    });
    expect(s.items.k.state).toBe("done");
    expect(canvasOf(m, s)).toContain("(ticked by user)");
    expect(setTask(s, m.nodes, "k", "answered")).toBeNull();
  });

  it("writes the context page", () => {
    const m = mapWithRoot();
    const s = newState();
    applyOps(
      m,
      [
        { op: "add", id: "t", parent: "root", type: "topic", title: "T" },
        {
          op: "add",
          id: "k",
          parent: "t",
          type: "task",
          title: "Ship it",
          summary: "open a PR",
        },
        {
          op: "add",
          id: "d",
          parent: "t",
          type: "decision",
          title: "Use hooks",
        },
      ],
      { clean: (op) => cleanItemOp(s, op) },
    );
    s.summary = "Building the chat map.";
    const page = contextPage(m, s);
    expect(page).toContain("## Where it stands\nBuilding the chat map.");
    expect(page).toContain("## Pending\n- Ship it: open a PR");
    expect(page).toContain("## Decided\n- Use hooks");
  });
});

describe("the main chat's inbox", () => {
  it("hands over what is new once", () => {
    const s = newState();
    post(s, "Side chat answered", 1);
    post(s, "You ticked a task", 2);
    expect(takeUnsent(s).map((o) => o.text)).toEqual([
      "Side chat answered",
      "You ticked a task",
    ]);
    expect(takeUnsent(s)).toEqual([]);
    post(s, "again", 3);
    expect(takeUnsent(s).map((o) => o.text)).toEqual(["again"]);
  });

  it("keeps the outbox short", () => {
    const s = newState();
    for (let i = 0; i < 50; i++) post(s, `n${i}`, i);
    expect(s.outbox).toHaveLength(40);
    expect(takeUnsent(s)[0].text).toBe("n10");
  });

  it("says nothing to the plugin's caller when nothing is new", () => {
    const m = newMap("x", "chat");
    expect(chat.unsent?.(m)).toBe("");
  });
});

describe("the hook installer", () => {
  it("adds the hook once, keeping your other settings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-hook-"));
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        model: "opus",
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "echo hi" }] },
          ],
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
    );
    expect(installHook(4317, { file })).toBe("installed");
    expect(installHook(4317, { file })).toBe("unchanged");
    expect(installHook(4318, { file })).toBe("updated");
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(s.model).toBe("opus");
    expect(s.hooks.Stop).toHaveLength(1);
    const cmds = s.hooks.UserPromptSubmit.flatMap(
      (g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command),
    );
    expect(cmds).toEqual(["echo hi", hookCommand(4318)]);
  });

  it("never overwrites a settings file it cannot read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-hook-"));
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "{ not json");
    expect(() => installHook(4317, { file })).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("{ not json");
  });
});

describe("reading the transcript as it grows", () => {
  it("reads whole lines only, and a moved file without repeats", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-claude-"));
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = home;
    try {
      const a = path.join(home, "projects", "-a");
      fs.mkdirSync(a, { recursive: true });
      const file = path.join(a, "conv-1.jsonl");
      fs.writeFileSync(file, `${you("u1", "héllo ✓")}\n${claude("a1", "hi")}`);
      const m = newMap("x", "chat");
      m.conversation = { id: "conv-1", cwd: "/a", title: "x" };
      const s = chatState(m);
      // the reply's line is not finished yet
      expect(readNew(m)).toBe(true);
      expect(s.turns.map((t) => t.text)).toEqual(["héllo ✓"]);
      fs.appendFileSync(file, `\n${you("u2", "more")}\n`);
      expect(readNew(m)).toBe(true);
      expect(s.turns.map((t) => t.text)).toEqual(["héllo ✓", "hi", "more"]);
      expect(readNew(m)).toBe(false);
      // the conversation moves to another folder, its history with it
      const b = path.join(home, "projects", "-b");
      fs.mkdirSync(b);
      fs.renameSync(file, path.join(b, "conv-1.jsonl"));
      fs.appendFileSync(
        path.join(b, "conv-1.jsonl"),
        `${claude("a2", "done")}\n`,
      );
      expect(readNew(m)).toBe(true);
      expect(s.turns.map((t) => t.text)).toEqual([
        "héllo ✓",
        "hi",
        "more",
        "done",
      ]);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    }
  });
});

describe("what the review found", () => {
  it("does not read a compacted conversation's summary as yours", () => {
    const turns: Turn[] = [];
    readTurns(
      [
        you("c1", "This session is being continued…", {
          isCompactSummary: true,
          isVisibleInTranscriptOnly: true,
        }),
        you("u1", "carry on"),
      ],
      turns,
      new Set(),
    );
    expect(turns.map((t) => t.text)).toEqual(["carry on"]);
  });

  it("keeps a side chat to its own node", () => {
    const m = newMap("x", "chat");
    makeNode(m.nodes, { id: "root", parent: null, kind: "fact", title: "c" });
    const s = newState();
    const clean = (scope: string | null) => (op: Raw) =>
      cleanItemOp(s, op, m.nodes, scope);
    applyOps(
      m,
      [
        { op: "add", id: "a", parent: "root", type: "topic", title: "A" },
        { op: "add", id: "b", parent: "root", type: "topic", title: "B" },
        { op: "add", id: "a1", parent: "a", type: "task", title: "A1" },
        { op: "add", id: "b1", parent: "b", type: "task", title: "B1" },
      ],
      { clean: clean(null) },
    );
    // a side chat on A tries to tick B's task and file a topic of its own
    applyOps(
      m,
      [
        { op: "update", id: "b1", state: "done" },
        { op: "update", id: "a1", state: "done" },
        { op: "add", id: "a2", parent: "root", type: "task", title: "A2" },
      ],
      { scope: "a", clean: clean("a") },
    );
    expect(s.items.b1.state).toBe("pending");
    expect(m.nodes.b1.status).toBe("open");
    expect(s.items.a1.state).toBe("done");
    expect(m.nodes.a2.parent).toBe("a");
    expect(s.items.a2.type).toBe("task");
  });

  it("lets a side chat's summary go quietly", () => {
    const m = newMap("x", "chat");
    expect(
      chat.applyOp?.(m, { op: "summary", text: "x" }, { scope: "a" }),
    ).toBeNull();
    expect(
      chat.applyOp?.(m, { op: "summary", text: "x" }, { scope: null }),
    ).toBe(1);
  });

  it("refuses ids that are not plain", () => {
    const s = newState();
    expect(setTask(s, {}, "constructor", "done")).toBeNull();
    expect(setTask(s, {}, "__proto__", "done")).toBeNull();
  });

  it("files a long conversation a batch at a time", () => {
    const s = newState();
    s.turns = Array.from({ length: BATCH_TURNS + 50 }, (_, i) => ({
      n: i + 1,
      who: "you" as const,
      text: "x".repeat(2000),
      ts: i,
    }));
    expect(batchEnd(s)).toBe(BATCH_TURNS);
    s.mapped = BATCH_TURNS;
    expect(batchEnd(s)).toBe(BATCH_TURNS + 50);
    s.mapped = 0;
    s.upTo = batchEnd(s);
    expect(digest(s).length).toBeLessThan(60_000);
  });

  it("leaves another hook named hook.ts alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-hook-"));
    const file = path.join(dir, "settings.json");
    const mine = 'node "/x/my-skill/hook.ts"';
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: mine }] }],
        },
      }),
    );
    installHook(4317, { file });
    installHook(4318, { file });
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    const cmds = s.hooks.UserPromptSubmit.flatMap(
      (g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command),
    );
    expect(cmds).toEqual([mine, hookCommand(4318)]);
    expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("finds a resumed conversation's new file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-proj-"));
    const old = path.join(dir, "old-id.jsonl");
    fs.writeFileSync(old, `${line({ sessionId: "old-id", type: "user" })}\n`);
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(old, past, past);
    fs.writeFileSync(
      path.join(dir, "other.jsonl"),
      `${line({ sessionId: "other", type: "user" })}\n`,
    );
    const next = path.join(dir, "new-id.jsonl");
    fs.writeFileSync(
      next,
      `${line({ sessionId: "old-id", type: "user" })}\n${line({ sessionId: "new-id", type: "user" })}\n`,
    );
    expect(successor(old, "old-id")).toBe(next);
    expect(successor(next, "new-id")).toBeNull();
  });
});
