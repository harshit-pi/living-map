// The list of your maps: what waits on you comes first, then the newest link.

import assert from "node:assert/strict";
import { test } from "vitest";

import { summarize } from "./chats.ts";
import type { Conv } from "./db.ts";
import type { LedgerView } from "../shared/ledger.ts";

const conv = (root: string, linkedAt: number, title = ""): Conv => ({
  root,
  ids: [root],
  title,
  cwd: `/work/${root}`,
  file: "",
  lookedTurn: 0,
  following: true,
  linkedAt,
  skipped: 0,
});

const view = (waiting: number, turns: number, title = "from the map") =>
  ({
    title,
    turns,
    strip: {
      doing: null,
      waiting: Array.from({ length: waiting }, (_, i) => `i${i}`),
    },
  }) as unknown as LedgerView;

test("chats waiting on you come first, then the newest link; a chat with no map still lists", () => {
  const views: Record<string, LedgerView> = {
    a: view(0, 12, "A"),
    b: view(2, 30),
    c: view(1, 3),
    d: view(2, 8),
  };
  const got = summarize(
    [
      conv("a", 400, "Chat A"),
      conv("b", 100),
      conv("c", 300),
      conv("d", 200),
      conv("e", 500),
    ],
    (root) => views[root] ?? null,
  );
  assert.deepEqual(
    got.map((c) => `${c.conv}:${c.waiting}`),
    ["d:2", "b:2", "c:1", "e:0", "a:0"],
  );
  assert.equal(got.find((c) => c.conv === "a")!.title, "Chat A");
  assert.equal(got.find((c) => c.conv === "b")!.title, "from the map");
  assert.deepEqual(
    got.find((c) => c.conv === "e"),
    {
      conv: "e",
      title: "",
      cwd: "/work/e",
      linkedAt: 500,
      following: true,
      turns: 0,
      waiting: 0,
    },
  );
});
