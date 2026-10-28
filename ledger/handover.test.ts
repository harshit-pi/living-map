// The handover on disk: fixed sections from the map (waiting on you, closes
// to check, next steps, still open, decided with date and reason), one file
// per chat and one per folder, yours alone, and written only when it changed.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { place } from "./apply.ts";
import type { Conv, State } from "./db.ts";
import {
  folderName,
  handoverPaths,
  handoverText,
  writeHandover,
} from "./handover.ts";
import { emptyStore, type Item } from "./items.ts";
import { buildView } from "./view.ts";

const item = (
  id: string,
  type: Item["type"],
  state: string,
  src: number,
  extra: Partial<Item> = {},
): Item => ({
  id,
  type,
  state,
  title: `${type} ${id}`,
  body: "",
  quote: "q",
  src: [src],
  parent: type === "topic" ? null : "i1",
  basis: "said",
  links: [],
  writers: {},
  ...extra,
});

const conv = (root: string, cwd: string, title = "A chat"): Conv => ({
  root,
  ids: [root],
  title,
  cwd,
  file: "",
  lookedTurn: 0,
  following: true,
  linkedAt: 0,
  skipped: 0,
});

function state(root = "c1", cwd = "/work/app"): State {
  const store = emptyStore(root, "Sessions");
  for (const i of [
    item("i1", "topic", "", 1),
    item("i2", "ask", "waiting", 6, {
      title: "Approve the migration",
      links: [{ rel: "blocks", to: "i4" }],
    }),
    item("i3", "question", "answered", 3, {
      owner: "you",
      title: "Which region?",
      unconfirmed: { from: "open", to: "answered", turn: 5 },
    }),
    item("i4", "task", "to-do", 4, {
      owner: "claude",
      title: "Run the migration",
    }),
    item("i5", "question", "open", 4, {
      owner: "claude",
      title: "Does the index fit?",
    }),
    item("i6", "decision", "decided", 2, {
      title: "Store sessions in Postgres",
      body: "durable, and already running",
    }),
    item("i7", "task", "done", 2, { title: "Write the schema" }),
  ])
    store.items.set(i.id, i);
  store.read = 6;
  const s: State = {
    conv: conv(root, cwd, "Sessions"),
    store,
    meta: new Map(),
  };
  place(s, Date.parse("2026-10-27T10:00:00Z"));
  return s;
}

const view = (s: State) =>
  buildView(s, {
    turns: 7,
    behind: 1,
    following: true,
    spend: { calls: 0, usd: 0, todayUsd: 0 },
  });

test("the handover has fixed sections, each saying where its items came up", () => {
  const s = state();
  const t = handoverText(view(s), s);
  assert.match(t, /^# Handover: Sessions\n/);
  assert.match(t, /Filed up to turn 6 of 7\. Chat `c1` in `\/work\/app`\./);
  assert.match(
    t,
    /## Waiting on you \(1\)\n- Approve the migration \(turn 6; holds up: Run the migration\)/,
  );
  assert.match(
    t,
    /## Closed by the map, to check \(1\)\n- Which region\?: marked answered at turn 5, with nothing in the chat that says so/,
  );
  assert.match(
    t,
    /## Next steps \(1\)\n- Run the migration \(Claude, to-do, turn 4\)/,
  );
  assert.match(
    t,
    /## Still open \(1\)\n- Does the index fit\? \(question, Claude to find out, turn 4\)/,
  );
  assert.match(
    t,
    /## Decided \(1\)\n- Store sessions in Postgres: durable, and already running \(2026-10-27, turn 2\)/,
  );
  // what is done is history, not handover
  assert.doesNotMatch(t, /Write the schema/);
});

test("with nothing in a section, it says so", () => {
  const s = state();
  for (const i of s.store.items.values())
    if (i.type !== "topic") i.retired = "x";
  const t = handoverText(view(s), s);
  assert.match(t, /Nothing waits on you\./);
  assert.match(t, /No tasks are open\./);
  assert.match(t, /Nothing has been decided yet\./);
  assert.doesNotMatch(t, /to check/);
});

test("one file per chat and one per folder, yours alone, rewritten only when it changes", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-handover-"));
  const s = state();
  const other = conv("c0", "/work/app", "Earlier chat");
  writeHandover(home, s, view(s), [s.conv, other]);
  const p = handoverPaths(home, s.conv);
  assert.equal(
    p.project,
    path.join(home, "handover", "projects", "-work-app.md"),
  );
  const chat = fs.readFileSync(p.chat, "utf8");
  const folder = fs.readFileSync(p.project!, "utf8");
  assert.ok(folder.startsWith(chat));
  assert.match(
    folder,
    new RegExp(
      `## Other chats in this folder\\n- Earlier chat: ${handoverPaths(home, other).chat}`,
    ),
  );
  assert.equal(fs.statSync(p.chat).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(p.chat)).mode & 0o777, 0o700);
  // the same map again: the file is left alone
  fs.utimesSync(p.chat, new Date(0), new Date(0));
  writeHandover(home, s, view(s), [s.conv, other]);
  assert.equal(fs.statSync(p.chat).mtimeMs, 0);
  // a change is written
  s.store.items.get("i2")!.state = "done";
  writeHandover(home, s, view(s), [s.conv, other]);
  assert.match(fs.readFileSync(p.chat, "utf8"), /Nothing waits on you\./);
  // a chat with no folder gets its own file only
  const loose = state("c9", "");
  writeHandover(home, loose, view(loose), [loose.conv]);
  assert.equal(handoverPaths(home, loose.conv).project, null);
  assert.ok(fs.existsSync(handoverPaths(home, loose.conv).chat));
});

test("a folder is named the way Claude Code names its own", () => {
  assert.equal(folderName("/Users/me/my app"), "-Users-me-my-app");
});
