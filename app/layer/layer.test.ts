import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyLayerOp,
  behind,
  VIEW_EVERY_MS,
  VIEW_QUIET_MS,
  viewDue,
  batchEnd,
  BATCH_TURNS,
  claudeTodo,
  cleanUserText,
  contextPage,
  decided,
  digest,
  needsYou,
  newState,
  outlineOf,
  post,
  postFromView,
  readTurns,
  setState,
  shouldFollow,
  stillOpen,
  takeUnsent,
} from "./core.ts";
import { layerFor, readNew } from "./follow.ts";
import type { Turn } from "./shared.ts";
import { successor } from "../server/providers/claude-sessions.ts";
import { newMap } from "../server/store.ts";
import { hookCommand, installHook } from "../skill/install.ts";

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
  const filed = () => {
    const s = newState("c1", "Teleport");
    for (const op of [
      { op: "item", id: "setup", type: "topic", title: "Setup", turn: 1 },
      {
        op: "item",
        id: "skill",
        parent: "setup",
        type: "task",
        state: "pending",
        title: "Install skill",
        turn: 5,
      },
      {
        op: "item",
        id: "trust",
        parent: "setup",
        type: "task",
        owner: "you",
        title: "Answer the prompt",
      },
      {
        op: "item",
        id: "which",
        parent: "setup",
        type: "question",
        title: "Which view?",
      },
      {
        op: "item",
        id: "a",
        parent: "which",
        type: "option",
        title: "Explore",
      },
      { op: "item", id: "b", parent: "which", type: "option", title: "Learn" },
      {
        op: "item",
        id: "how",
        parent: "setup",
        type: "question",
        owner: "claude",
        title: "How to detect?",
      },
    ])
      applyLayerOp(s, op);
    return s;
  };

  it("files the model's items with their type, state and owner", () => {
    const s = filed();
    expect(s.items.skill).toMatchObject({
      parent: "setup",
      type: "task",
      state: "pending",
      owner: "claude",
      turn: 5,
    });
    expect(s.items.trust.owner).toBe("you");
    expect(s.items.which).toMatchObject({ state: "open", owner: "you" });
    expect(s.items.a.parent).toBe("which");
    expect(outlineOf(s)).toContain(
      "- [skill] task · pending · on Claude · turn 5 · Install skill",
    );
    // an update names only what changes
    applyLayerOp(s, { op: "item", id: "skill", state: "done" });
    expect(s.items.skill).toMatchObject({
      state: "done",
      title: "Install skill",
    });
  });

  it("says what is on whom", () => {
    const s = filed();
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(ids(needsYou(s))).toEqual(["trust", "which"]);
    expect(ids(claudeTodo(s))).toEqual(["skill"]);
    expect(ids(stillOpen(s))).toEqual(["how"]);
    setState(s, "a", "chosen");
    expect(ids(needsYou(s))).toEqual(["trust"]);
    expect(ids(decided(s))).toEqual(["a"]);
  });

  it("hangs items where they fit", () => {
    const s = filed();
    applyLayerOp(s, {
      op: "item",
      id: "t2",
      type: "topic",
      parent: "skill",
      title: "T2",
    });
    applyLayerOp(s, {
      op: "item",
      id: "x",
      type: "task",
      parent: "nowhere",
      title: "X",
    });
    applyLayerOp(s, {
      op: "item",
      id: "o",
      type: "option",
      parent: "setup",
      title: "O",
    });
    expect(s.items.t2.parent).toBeNull();
    // the newest topic takes what names no fitting parent
    expect(s.items.x.parent).toBe("t2");
    expect(s.items.o.parent).toBe("t2");
    expect(applyLayerOp(s, { op: "item", id: "root", type: "topic" })).toBe(0);
    expect(applyLayerOp(s, { op: "add", id: "n" })).toBeNull();
  });

  it("keeps your word over the model's", () => {
    const s = filed();
    expect(setState(s, "skill", "done")?.byYou).toBe(true);
    applyLayerOp(s, { op: "item", id: "skill", state: "pending" });
    expect(s.items.skill.state).toBe("done");
    expect(outlineOf(s)).toContain("(set by user)");
    expect(setState(s, "skill", "answered")).toBeNull();
    applyLayerOp(s, { op: "forget", id: "skill" });
    expect(s.items.skill).toBeDefined();
  });

  it("keeps the summary, Claude's now and the view it suggests", () => {
    const s = filed();
    applyLayerOp(s, { op: "summary", text: "Building.", now: "the rail" });
    applyLayerOp(s, {
      op: "view",
      mode: "learn",
      question: "How do CRDTs merge?",
    });
    applyLayerOp(s, { op: "view", mode: "chat" });
    expect([s.summary, s.now]).toEqual(["Building.", "the rail"]);
    expect(s.suggested).toEqual({
      mode: "learn",
      question: "How do CRDTs merge?",
    });
  });

  it("writes the context page", () => {
    const s = filed();
    s.summary = "Building the rail.";
    const page = contextPage(s);
    expect(page).toContain("## Where it stands\nBuilding the rail.");
    expect(page).toContain("## Waiting on the user\n- Answer the prompt");
    expect(page).toContain("## Claude still to do\n- Install skill");
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

  it("folds a run of moves on a view into one line", () => {
    const s = newState();
    postFromView(s, "Explore", "Chose B", 1000);
    postFromView(s, "Explore", "Set aside C", 2000);
    postFromView(s, "Design", "Added a cache", 3000);
    expect(takeUnsent(s).map((o) => o.text)).toEqual([
      "On the Explore view of the map, the user: Chose B; Set aside C",
      "On the Design view of the map, the user: Added a cache",
    ]);
    // heard: the next move starts a line of its own
    postFromView(s, "Design", "Added a queue", 4000);
    expect(takeUnsent(s)).toHaveLength(1);
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
      const m = newMap("x", "explore");
      m.conversation = { id: "conv-1", cwd: "/a", title: "x" };
      const s = layerFor(m)!;
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

  it("keeps a side chat to its own item", () => {
    const s = newState();
    for (const op of [
      { op: "item", id: "a", type: "topic", title: "A" },
      { op: "item", id: "b", type: "topic", title: "B" },
      { op: "item", id: "a1", parent: "a", type: "task", title: "A1" },
      { op: "item", id: "b1", parent: "b", type: "task", title: "B1" },
    ])
      applyLayerOp(s, op);
    const side = { scope: "a" };
    expect(applyLayerOp(s, { op: "item", id: "b1", state: "done" }, side)).toBe(
      0,
    );
    applyLayerOp(s, { op: "item", id: "a1", state: "done" }, side);
    applyLayerOp(
      s,
      { op: "item", id: "a2", parent: "b", type: "task", title: "A2" },
      side,
    );
    expect(s.items.b1.state).toBe("pending");
    expect(s.items.a1.state).toBe("done");
    expect(s.items.a2.parent).toBe("a");
    // the summary is the main chat's: a side chat's goes quietly
    expect(applyLayerOp(s, { op: "summary", text: "x" }, side)).toBeNull();
    expect(applyLayerOp(s, { op: "forget", id: "b" }, side)).toBe(0);
  });

  it("refuses ids that are not plain", () => {
    const s = newState();
    expect(setState(s, "constructor", "done")).toBeNull();
    expect(setState(s, "__proto__", "done")).toBeNull();
    expect(applyLayerOp(s, { op: "item", id: "__proto__", type: "task" })).toBe(
      0,
    );
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

describe("a view keeping itself current", () => {
  const at = (now: number) => {
    const s = newState("c");
    const m = newMap("Board", "explore");
    m.createdAt = 0;
    m.chat.push({ role: "claude", text: "drawn", ts: 1000 });
    s.turns = [
      { n: 1, who: "you", text: "old", ts: 500 },
      { n: 2, who: "you", text: "new", ts: 2000 },
    ];
    s.mapped = 2;
    s.activeAt = now - VIEW_QUIET_MS;
    return { s, m };
  };

  it("updates once the chat has moved on, been filed, and paused", () => {
    const now = 1_000_000;
    const { s, m } = at(now);
    expect(behind(s, m)).toBe(1);
    expect(viewDue(s, m, now, 0)).toBe(true);
    // not again within a couple of minutes
    expect(viewDue(s, m, now, now - VIEW_EVERY_MS + 1)).toBe(false);
  });

  it("waits while the chat is busy, the rail is behind, or you turned it off", () => {
    const now = 1_000_000;
    const busy = at(now);
    busy.s.activeAt = now - 1000;
    expect(viewDue(busy.s, busy.m, now, 0)).toBe(false);
    const filing = at(now);
    filing.s.mapped = 1;
    expect(viewDue(filing.s, filing.m, now, 0)).toBe(false);
    const off = at(now);
    off.s.autoView = false;
    expect(viewDue(off.s, off.m, now, 0)).toBe(false);
    const current = at(now);
    current.m.chat.push({ role: "claude", text: "again", ts: 3000 });
    expect(viewDue(current.s, current.m, now, 0)).toBe(false);
  });
});
