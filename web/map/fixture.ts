// A LedgerView built from the synthetic map in app/ledger/fixtures/map.ts,
// for working on the page without a linked chat (?fixture=1) and for tests.
// Its change items become the view's changes, as the server keeps them
// apart from the map's items. Actions apply here, in the page, so the
// fixture can be clicked through.

import { HEADER, ITEMS } from "../../ledger/fixtures/map.ts";
import type { MapItem } from "../../ledger/mermaid.ts";
import type {
  ChangeStatement,
  LedgerAction,
  LedgerItem,
  LedgerView,
  SideChat,
} from "../../shared/ledger.ts";

// sortable keys in the order the items were filed: what a fractional key
// minted after the last sibling would sort like
export const keyAt = (n: number) => `a${n.toString(36).padStart(4, "0")}`;

const turnOf = (s: string) => Number(s.replace(/^t/, "")) || 0;

const BODIES: Record<string, string> = {
  i18: "The branch with the simpler header is ready. Claude is waiting for you to say whether to push it.",
  i31: "Answer the riskiest unknowns first: extraction on the provider, transcript edge cases, and what changed on past sessions.",
  i35: "The design reviewer made two throwaway repos to try layouts. They can go once you have read its notes.",
  i37: "Both work across regions. Peering is simpler to run; the overlay is already in place and tested.",
  i43: "The overlay mesh was removed while moving to peering. Confirm that was meant, not a side effect.",
};

const LOOKED = 110;
const TURNS = 140;

const waitingOf = (i: MapItem) =>
  (i.type === "ask" && i.state === "waiting") ||
  (i.type === "question" && i.state === "open" && i.owner === "you");

const openOf = (i: MapItem) =>
  (i.type === "question" && i.state === "open") ||
  (i.type === "task" && (i.state === "to-do" || i.state === "doing")) ||
  (i.type === "ask" && i.state === "waiting") ||
  (i.type === "decision" && i.state === "reopened") ||
  (i.type === "assumption" && i.state === "assumed");

const CHANGE: Record<string, ChangeStatement["change"]> = {
  added: "added",
  removed: "removed",
  changed: "changed",
};

// `variant` shows the page's other states: empty, reading, error, filing
export function fixtureView(variant = ""): LedgerView {
  const v = fullView();
  if (variant === "filing")
    return {
      ...v,
      health: {
        ...v.health,
        filing: { turns: [TURNS - 1, TURNS], since: Date.now() - 4000 },
        lag: { turn: TURNS - 2, ms: 31_400, modelMs: 9_800 },
      },
    };
  if (variant === "empty" || variant === "reading")
    return withStrip({
      ...v,
      items: [],
      changes: [],
      lookedTurn: v.turns,
      strip: { ...v.strip, doing: null },
      health: {
        following: true,
        behind: variant === "reading" ? 280 : 0,
        reading: variant === "reading" ? { done: 120, total: 400 } : undefined,
      },
    });
  if (variant === "error")
    return {
      ...v,
      health: {
        ...v.health,
        error: "The model's reply didn't match the schema",
      },
    };
  return v;
}

function fullView(): LedgerView {
  const byId = new Map(ITEMS.map((i) => [i.id, i]));
  const changes: ChangeStatement[] = ITEMS.filter(
    (i) => i.type === "change",
  ).map((i) => ({
    id: i.id,
    change: CHANGE[i.state] ?? "changed",
    kind: "module",
    text: i.label,
    module: (i.parent && byId.get(i.parent)?.label) || "The project",
    file: "",
    turn: turnOf(i.src?.[0] ?? ""),
    low: false,
  }));
  const kept = ITEMS.filter((i) => i.type !== "change");
  const items: LedgerItem[] = kept.map((i, n) => {
    const src = (i.src ?? []).map(turnOf);
    return {
      id: i.id,
      type: i.type as LedgerItem["type"],
      state: i.state,
      title: i.label,
      body: BODIES[i.id] ?? "",
      quote: i.label,
      src,
      parent: i.parent,
      owner: i.owner,
      basis: i.type === "assumption" ? "inferred" : "said",
      links: i.links ?? [],
      waiting: waitingOf(i),
      open: openOf(i),
      isNew: src.some((t) => t > LOOKED),
      order: keyAt(n),
      folded: i.type === "topic" && i.state === "done" ? true : undefined,
    };
  });
  return withStrip({
    conv: HEADER.conv,
    title: HEADER.title,
    turns: TURNS,
    read: TURNS - 2,
    lookedTurn: LOOKED,
    items,
    sides: [],
    strip: {
      doing: "Transcript adapter tests",
      waiting: [],
    },
    changes,
    spend: { calls: 41, usd: 0.62, todayUsd: 0.18 },
    health: { following: true, behind: 2 },
  });
}

// the strip's counts, from the items, as the server works them out
function withStrip(v: LedgerView): LedgerView {
  const waiting = v.items
    .filter((i) => i.waiting)
    .sort((a, b) => (a.src[0] ?? 0) - (b.src[0] ?? 0))
    .map((i) => i.id);
  return {
    ...v,
    strip: {
      ...v.strip,
      waiting,
    },
  };
}

const CLOSED = new Set(["done", "answered", "taken", "dropped", "struck"]);
// side chats ended in the fixture
const closed = new Set<string>();

// A side chat in the fixture: it opens and takes your words, and says it
// can't answer here (no model runs on the fixture).
export function localSide(
  v: LedgerView,
  all: Record<string, SideChat>,
  a: LedgerAction,
): SideChat | undefined {
  if (a.type === "side-open") {
    const had = Object.values(all).find((s) => s.item === a.item);
    if (had) return had;
    const item = v.items.find((i) => i.id === a.item);
    return {
      id: `s${Object.keys(all).length + 1}`,
      item: a.item,
      title: item?.title ?? a.item,
      messages: [],
      busy: false,
      proposals: [],
      tokens: { input: 0, output: 0, usd: 0 },
    };
  }
  if (a.type === "side-say" && all[a.side]) {
    const s = all[a.side]!;
    return {
      ...s,
      messages: [
        ...s.messages,
        { role: "you", text: a.text, at: 0 },
        {
          role: "claude",
          text: "Side chats answer on a linked chat; this is the fixture.",
          at: 0,
        },
      ],
    };
  }
  return undefined;
}

// an action applied to the fixture, as the server would file it
export function applyLocal(
  v: LedgerView,
  a: LedgerAction,
  sides: Record<string, SideChat> = {},
): LedgerView {
  const edit = (id: string, f: (i: LedgerItem) => LedgerItem | null) => ({
    ...next,
    items: next.items.flatMap((i) => {
      if (i.id !== id) return [i];
      const n = f(i);
      return n ? [n] : [];
    }),
  });
  let next: LedgerView = {
    ...v,
    sides: Object.values(sides)
      .filter((s) => !closed.has(s.id))
      .map((s) => ({ id: s.id, item: s.item, title: s.title, busy: false })),
  };
  const sent = { at: 1, heard: false };
  if (a.type === "side-close") closed.add(a.side);
  if (a.type === "state")
    next = edit(a.item, (i) => ({
      ...i,
      state: a.state,
      waiting: false,
      open: !CLOSED.has(a.state) && i.open,
      sent,
    }));
  else if (a.type === "answer")
    next = edit(a.item, (i) => ({
      ...i,
      state: i.type === "ask" ? "done" : "answered",
      waiting: false,
      open: false,
      sent,
    }));
  else if (a.type === "not-right") next = edit(a.item, () => null);
  else if (a.type === "fold")
    next = edit(a.item, (i) => ({ ...i, folded: a.folded }));
  else if (a.type === "looked")
    next = {
      ...next,
      lookedTurn: v.turns,
      items: next.items.map((i) => (i.isNew ? { ...i, isNew: false } : i)),
    };
  else if (a.type === "review")
    next = {
      ...next,
      changes: next.changes.map((c) =>
        c.id === a.change ? { ...c, review: a.review } : c,
      ),
    };
  return withStrip(next);
}
