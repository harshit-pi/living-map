// mermaid+ round trip: what the writer writes, our reader reads back the same
// tree, whatever the labels hold; and the writer never writes what Mermaid
// rejects (brackets, quotes and HTML stay inside quoted, encoded labels; a
// class line always sits under its own node).

import assert from "node:assert/strict";
import { test } from "vitest";

import { HEADER, ITEMS } from "./fixtures/map.ts";
import { fromMermaid, toLines, toMermaid, type MapItem } from "./mermaid.ts";

// compared in id order: the writer writes in tree order
const norm = (items: MapItem[]) =>
  [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((i) => ({
      id: i.id,
      type: i.type,
      state: i.state,
      label: i.label,
      parent: i.parent,
      owner: i.owner,
      src: i.src,
      links: i.links,
    }));

test("the fixture map comes back exactly as written", () => {
  const text = toMermaid(ITEMS, HEADER);
  const back = fromMermaid(text);
  assert.deepEqual(back.skipped, []);
  assert.deepEqual(back.header, HEADER);
  assert.deepEqual(norm(back.items), norm(ITEMS));
});

test("labels with brackets, quotes, HTML, entities and newlines round-trip", () => {
  const labels = [
    "a [b] c",
    "How (really)?",
    "Push {x}?",
    "Map<string, Item[]>",
    'say "hi"',
    "already #quot; encoded",
    "50% done; 3/4 # left",
    "line one\nline two",
    "see ::icon(fa)",
    "%% not a comment",
    ":::not a class",
    "emoji ✓ and ü",
  ];
  const items: MapItem[] = labels.map((label, n) => ({
    id: `i${n + 1}`,
    type: n % 2 ? "question" : "ask",
    state: "open",
    label,
    parent: null,
  }));
  const back = fromMermaid(toMermaid(items, HEADER));
  assert.deepEqual(back.skipped, []);
  assert.deepEqual(
    back.items.map((i) => i.label),
    labels.map((l) => l.replace(/\n/g, " ")),
  );
});

test("what is written has no bare brackets or HTML, and every class line follows its node", () => {
  const text = toMermaid(ITEMS, HEADER);
  const lines = text.split("\n");
  for (const [n, line] of lines.entries()) {
    if (line.trim().startsWith(":::")) {
      const prev = lines[n - 1] ?? "";
      assert.match(prev, /^ *[\w-]+(\(\(|\{\{|\(|\[)"/, line);
      assert.equal(
        prev.length - prev.trimStart().length,
        line.length - line.trimStart().length,
      );
    }
    if (!line.startsWith("%%") && line.includes('"')) {
      const label = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
      assert.doesNotMatch(label, /["<>]/, line);
    }
  }
});

test("an item whose parent is unknown hangs from the root instead of vanishing", () => {
  const items: MapItem[] = [
    { id: "i1", type: "task", state: "to-do", label: "orphan", parent: "i99" },
  ];
  const back = fromMermaid(toMermaid(items, HEADER));
  assert.equal(back.items[0]?.parent, null);
});

test("lines the reader can't place are returned, not guessed", () => {
  const back = fromMermaid(
    [
      "mindmap",
      '  root(("x"))',
      "    i1[unquoted]",
      ":::task done",
      "%% i9 owner=you",
      '    i2["ok"]',
      ":::weird open",
    ].join("\n"),
  );
  assert.deepEqual(
    back.items.map((i) => i.id),
    ["i2"],
  );
  assert.equal(back.skipped.length, 4);
});

test("the one-line form names every item with its state and parent", () => {
  const text = toLines(ITEMS, HEADER);
  assert.equal(text.split("\n").length, ITEMS.length + 1);
  assert.match(
    text,
    /^i40 change removed "Nebula overlay mesh" in=i36 src=t125 replaced-by=i41$/m,
  );
});
