import { describe, expect, it } from "vitest";

import { applyLocal, fixtureView, keyAt } from "./fixture.ts";
import {
  holdView,
  layout,
  moves,
  NARROW,
  ROOT,
  sizeFor,
  WIDE,
  type Layout,
} from "./layout.ts";
import {
  changedIds,
  countsOf,
  countsText,
  descendants,
  foldsAbove,
  groupsOf,
  nowTopic,
  search,
} from "./lens.ts";
import { newIds, snapOf } from "./since.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

const item = (
  id: string,
  parent: string | null,
  order: string,
  extra: Partial<LedgerItem> = {},
): LedgerItem => ({
  id,
  type: parent ? "task" : "topic",
  state: parent ? "to-do" : "open",
  title: id,
  body: "",
  quote: "",
  src: [1],
  parent,
  basis: "said",
  links: [],
  waiting: false,
  open: true,
  isNew: false,
  order,
  ...extra,
});

// a small seeded generator, so the growth script is the same on every run
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const { col: COL, row: ROW } = WIDE;

describe("layout", () => {
  it("grows left to right, newest first, a parent on its first child's row", () => {
    const l = layout([
      item("t1", null, "a1"),
      item("a", "t1", "a1"),
      item("b", "t1", "a2"),
      item("t2", null, "a2"),
    ]);
    const at = (id: string) => l.nodes.get(id)!;
    expect(at(ROOT)).toMatchObject({ x: 0, y: 0 });
    expect(at("t2")).toMatchObject({ x: COL, y: 0 });
    expect(at("t1")).toMatchObject({ x: COL, y: ROW });
    expect(at("b")).toMatchObject({ x: 2 * COL, y: ROW });
    expect(at("a")).toMatchObject({ x: 2 * COL, y: 2 * ROW });
    expect(l.rows).toBe(3);
    expect(l.edges).toContainEqual({ from: "t1", to: "b" });
  });

  it("sorts siblings by order key, newest first, not by the order items arrive", () => {
    const l = layout([
      item("t1", null, "a1"),
      item("early", "t1", "a2"),
      item("late", "t1", "a3"),
    ]);
    expect(l.nodes.get("late")!.y).toBeLessThan(l.nodes.get("early")!.y);
  });

  it("collapses a folded topic's rows", () => {
    const items = [
      item("t1", null, "a1"),
      item("a", "t1", "a1"),
      item("b", "t1", "a2"),
      item("t2", null, "a2"),
    ];
    const l = layout(items, (id) => id === "t2" || id === "t1");
    expect(l.nodes.has("a")).toBe(false);
    expect(l.nodes.get("t1")!.y).toBe(ROW);
  });

  it("hangs an item whose parent is gone off the root, and survives a loop", () => {
    const l = layout([
      item("x", "missing", "a1"),
      item("p", "q", "a2"),
      item("q", "p", "a3"),
    ]);
    expect(l.nodes.get("x")!.parent).toBe(ROOT);
    expect(l.nodes.has("p")).toBe(false);
  });

  it("draws cross-links between drawn nodes only", () => {
    const l = layout([
      item("t1", null, "a1"),
      item("a", "t1", "a1", { links: [{ rel: "about", to: "b" }] }),
      item("b", "t1", "a2", { links: [{ rel: "about", to: "gone" }] }),
    ]);
    expect(l.links).toEqual([{ from: "a", to: "b", rel: "about" }]);
  });

  it("sizes nodes by the pane's width class, not its exact width", () => {
    expect(sizeFor(400)).toBe(NARROW);
    expect(sizeFor(639)).toBe(NARROW);
    expect(sizeFor(640)).toBe(WIDE);
    // three columns, from a topic at an 8 px margin, inside a 480 px pane
    expect(8 + 2 * NARROW.col + NARROW.w).toBeLessThanOrEqual(480);
    const items = [item("t1", null, "a1"), item("a", "t1", "a1")];
    expect(layout(items, undefined, NARROW).nodes.get("a")).toMatchObject({
      x: 2 * NARROW.col,
      y: 0,
    });
  });

  // The rule: a new item never moves a node on an earlier row, and moves the
  // ones after it only by whole rows, which the camera can make up for. Checked at every step of a
  // 300-step growth with topics, nesting and folded topics, in both sizes.
  it.each([
    ["wide", WIDE],
    ["narrow", NARROW],
  ])(
    "keeps every node above an insert still over 300 appends (%s)",
    (_, size) => {
      const rand = rng(7);
      const items: LedgerItem[] = [];
      const folded = new Set<string>();
      const isFolded = (id: string) => folded.has(id);
      let n = 0;
      let prev: Layout = layout(items, isFolded, size);
      let checked = 0;
      let shifted = 0;
      for (let step = 0; step < 300; step++) {
        const topics = items.filter((i) => i.type === "topic");
        const id = `i${++n}`;
        const order = keyAt(n);
        if (!topics.length || rand() < 0.12) {
          items.push(item(id, null, order));
          if (rand() < 0.2) folded.add(id);
        } else {
          // mostly under a recent item, sometimes anywhere
          const pool = rand() < 0.7 ? items.slice(-12) : items;
          const parent = pool[Math.floor(rand() * pool.length)];
          items.push(item(id, parent.id, order));
        }
        const next = layout(items, isFolded, size);
        const placed = next.nodes.get(id);
        const ms = moves(prev, next);
        if (!placed) {
          // filed inside a fold: nothing on screen moves at all
          expect(ms.every((m) => m.dx === 0 && m.dy === 0)).toBe(true);
        } else {
          for (const m of ms) {
            expect(m.dx).toBe(0);
            if (m.prevY < placed.y) {
              expect(m.dy).toBe(0);
              checked++;
            } else {
              expect(m.dy % size.row).toBe(0);
              expect(m.dy).toBeGreaterThanOrEqual(0);
              if (m.dy) shifted++;
            }
          }
        }
        prev = next;
      }
      // the script really exercised both sides of the rule
      expect(checked).toBeGreaterThan(1000);
      expect(shifted).toBeGreaterThan(100);
      expect(items.length).toBe(300);
    },
  );

  it("keeps nodes above still when an item lands between siblings", () => {
    const base = [
      item("t1", null, "a1"),
      item("a", "t1", "a1"),
      item("c", "t1", "a3"),
      item("t2", null, "a2"),
    ];
    const before = layout(base);
    const after = layout([...base, item("b", "t1", "a2")]);
    const y = after.nodes.get("b")!.y;
    for (const m of moves(before, after))
      if (m.prevY < y) expect(m.dy).toBe(0);
      else expect(m.dy).toBe(ROW);
  });
});

describe("the fixture", () => {
  const v = fixtureView();

  it("holds the fixture's items, its changes apart, with order keys", () => {
    expect(v.items.length + v.changes.length).toBe(46);
    expect(v.changes.map((c) => c.id)).toEqual([
      "i16",
      "i17",
      "i40",
      "i41",
      "i42",
    ]);
    const keys = v.items.map((i) => i.order);
    expect([...keys].sort()).toEqual(keys);
    expect(v.strip.waiting).toEqual(["i18", "i35", "i37", "i43"]);
  });

  it("lays out every item once its folds are open", () => {
    const l = layout(v.items);
    expect(l.nodes.size).toBe(v.items.length + 1);
    const folded = layout(
      v.items,
      (id) => !!v.items.find((i) => i.id === id)?.folded,
    );
    expect(folded.nodes.has("i2")).toBe(false);
    expect(folded.nodes.has("i37")).toBe(true);
  });

  it("applies actions in the page", () => {
    const answered = applyLocal(v, {
      type: "answer",
      item: "i18",
      text: "yes",
    });
    expect(answered.items.find((i) => i.id === "i18")).toMatchObject({
      state: "done",
      waiting: false,
    });
    expect(answered.strip.waiting).not.toContain("i18");
    const gone = applyLocal(v, { type: "not-right", item: "i45" });
    expect(gone.items.some((i) => i.id === "i45")).toBe(false);
    const looked = applyLocal(v, { type: "looked" });
    expect(looked.items.some((i) => i.isNew)).toBe(false);
  });
});

describe("lenses", () => {
  const v = fixtureView();

  it("counts a folded topic's items", () => {
    const c = countsOf(descendants(v.items, "i14"));
    expect(countsText(c)).toBe("1 waiting · 1 decided");
    expect(countsText({ waiting: 0, open: 0, decided: 0, settled: 0 })).toBe(
      "empty",
    );
    expect(countsText({ waiting: 0, open: 1, decided: 2, settled: 3 })).toBe(
      "1 open · 2 decided · 3 settled",
    );
  });

  it("groups the list by state, waiting first", () => {
    const g = groupsOf(v.items);
    expect(g[0].id).toBe("waiting");
    expect(g[0].items.map((i) => i.id)).toEqual(["i18", "i35", "i37", "i43"]);
    expect(g.flatMap((x) => x.items).length).toBe(
      v.items.filter((i) => i.type !== "topic").length,
    );
  });

  it("searches titles by every word", () => {
    expect(search(v.items, "nebula keep").map((i) => i.id)).toEqual([
      "i37",
      "i38",
    ]);
    expect(search(v.items, "  ")).toEqual([]);
  });

  it("finds the folds above an item, and the topic Now goes to", () => {
    expect(foldsAbove(v.items, "i9", (id) => id === "i5")).toEqual(["i5"]);
    // the topic whose items came up last (turns 120–131), not the one
    // still holding a task in progress
    expect(nowTopic(v.items)?.id).toBe("i36");
  });

  it("ties items to changes by turn or link", () => {
    expect([...changedIds(v.items, v.changes)]).toEqual(["i43"]);
  });
});

describe("since you looked", () => {
  const v = fixtureView();
  const order = layout(v.items).order;

  it("steps through what is new, in map order", () => {
    const snap = snapOf(v, order)!;
    expect(snap.ids.length).toBeGreaterThan(0);
    expect(new Set(snap.ids)).toEqual(newIds(v));
    expect(snap.ids).toEqual(order.filter((id) => snap.ids.includes(id)));
  });

  it("has nothing new on a chat you have never looked at", () => {
    const never = { ...v, lookedTurn: 0 };
    expect(newIds(never).size).toBe(0);
    expect(snapOf(never, order)).toBeNull();
  });
});

describe("holding the view", () => {
  const before = [
    item("t1", null, "a1"),
    item("a", "t1", "a1"),
    item("b", "t1", "a2"),
    item("t2", null, "a2"),
    item("c", "t2", "a1"),
  ];
  const after = [...before, item("t3", null, "a3"), item("d", "t2", "a2")];

  it("moves the camera by what the box in view moved, so it stays put", () => {
    const prev = layout(before);
    const next = layout(after);
    // looking at t1, two rows down: t3 lands above it and d above c
    const top = prev.nodes.get("t1")!.y;
    const dy = holdView(prev, next, top);
    expect(dy).toBe(next.nodes.get("t1")!.y - prev.nodes.get("t1")!.y);
    expect(dy).toBe(2 * ROW);
  });

  it("holds nothing at the top of the map, so new boxes show as they land", () => {
    expect(holdView(layout(before), layout(after), 0)).toBe(0);
  });

  it("holds nothing when nothing in view moved", () => {
    const l = layout(before);
    expect(holdView(l, l, 2 * ROW)).toBe(0);
  });
});
