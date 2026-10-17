// Explore's pure logic, no I/O: bringing the board state in line with the node
// map (and older maps onto boards), cleaning the model's board ops, and what
// the screen and the model read: the roll-up, the open list, Next, folding,
// tallies, the outline and the one-line summary.
//
//   map.nodes ──► reconcile ──► state ──► rollup · openItems · nextGap
//   model ops ──► applyExploreOp ─┘            └──► viewOf · outlineOf

import {
  cellKey,
  isCheck,
  MARKS,
  PLUGIN_ID,
  SHAPES,
  SURES,
  SURVIVES,
  WEIGHTS,
  type Against,
  type Board,
  type BoardView,
  type Cell,
  type ColumnView,
  type DecisionPoint,
  type ExploreState,
  type ExploreView,
  type Gap,
  type GroupView,
  type OpenItem,
  type QuestionView,
  type Rollup,
  type RowView,
  type Shape,
  type ShownCell,
  type Side,
  type Stand,
  type Survives,
  type Tally,
  type Weight,
} from "./shared.ts";
import { makeNode, pathTo, subtree } from "../../server/core/canvas.ts";
import { list, own, safeId, str, type Raw } from "../../server/core/types.ts";
import type { MapNode } from "../../shared/model.ts";

type Nodes = Record<string, MapNode>;

export const ROWS_MAX = 12; // wants on one board
export const AGAINST_KEPT = 5;
export const WRAP_MAX = 5; // Claude's assumptions, and its steps, per board
export const FACTS_PER_CELL = 4;
export const OPEN_MAX = 4;
export const DAY = 24 * 60 * 60 * 1000;

export const newState = (): ExploreState => ({
  v: 1,
  boards: {},
  stand: {},
  answers: {},
  takeaways: {},
  added: {},
});

export const newBoard = (
  question: string,
  shape: Shape,
  shapeBy: "you" | "claude" = "claude",
): Board => ({
  question,
  shape,
  shapeBy,
  rows: [],
  cells: {},
  against: {},
  assumptions: [],
  steps: [],
  criteriaTouched: false,
});

// ---------------------------------------------------------------- reading nodes

const byOrder = (a: MapNode, b: MapNode) => a.order - b.order;
export const rootOf = (nodes: Nodes): MapNode | undefined =>
  Object.values(nodes)
    .filter((n) => !n.parent)
    .sort(byOrder)[0];
export const childrenOf = (nodes: Nodes, id: string): MapNode[] =>
  Object.values(nodes)
    .filter((n) => n.parent === id)
    .sort(byOrder);
export const optionsOf = (nodes: Nodes, q: string): MapNode[] =>
  childrenOf(nodes, q).filter((n) => n.kind === "option");
const isQuestion = (nodes: Nodes, id: string) =>
  own(nodes, id)?.kind === "question";
// set aside by you: off the board, into the drawer
export const asideByYou = (n: MapNode) => !!n.dropped;
// still in the running: neither set aside by you nor by a Choose
export const inPlay = (n: MapNode) => !n.dropped && n.status !== "dropped";
const depthOf = (nodes: Nodes, id: string) => pathTo(nodes, id).length - 1;

// The model's text is cut to its limit in words and in characters.
// A cut lands between words, so a long name keeps whole words.
export function clip(v: unknown, words: number, chars: number): string {
  const s = str(v, 4000).replace(/\s+/g, " ").trim();
  const w = s.split(" ").slice(0, words).join(" ");
  if (w.length <= chars) return w;
  const cut = w.slice(0, chars + 1);
  const space = cut.lastIndexOf(" ");
  return (space > chars / 2 ? cut.slice(0, space) : cut.slice(0, chars)).trim();
}
const idOf = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && safeId(s) ? s : null;
};
const oneOf = <T extends string>(set: readonly T[], v: unknown): T | null =>
  set.includes(v as T) ? (v as T) : null;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
const named = (nodes: Nodes, id: string) => `"${own(nodes, id)?.title ?? id}"`;

// "Why did X happen?" asks for causes; a question with options is a choice.
export function inferShape(nodes: Nodes, q: string): Shape {
  if (/^\s*why\b/i.test(own(nodes, q)?.title ?? "")) return "causes";
  return optionsOf(nodes, q).length ? "choose" : "open";
}
export const shapeOf = (s: ExploreState, nodes: Nodes, q: string): Shape =>
  own(s.boards, q)?.shape ?? inferShape(nodes, q);

// A want's node summary, read on the Tree and in Learn: a suggestion you have
// not kept says so, so it never reads as something you want.
export const wantSummary = (weight: Weight, suggested: boolean) =>
  `${suggested ? "Claude's suggested want" : "What you want"} · ${weight}`;
export const WANT_SUMMARY = /^(What you want|Claude's suggested want) · /;

// An older map named no keep-as-is option; its title usually says which.
const KEEP_AS_IS =
  /^\s*(keep|stay|wait|do nothing|don['’]?t|no change|status quo|leave it|hold off)\b/i;

// ---------------------------------------------------------------- reconcile

function isState(v: unknown): v is ExploreState {
  return !!v && typeof v === "object" && (v as ExploreState).v === 1;
}

// The board state brought in line with the node map: what points at a node
// that is gone (or moved off its board) goes, every choice gets a board, and an
// older map's "Recommended:" and chosen options are carried over. Pure and
// idempotent: it returns a new state and never touches its inputs, so a view
// of an old map changes nothing on disk.
export function reconcile(state: unknown, nodes: Nodes): ExploreState {
  const s: ExploreState = isState(state) ? structuredClone(state) : newState();
  s.boards ??= {};
  s.stand ??= {};
  s.answers ??= {};
  s.takeaways ??= {};
  s.added ??= {};

  for (const q of Object.keys(s.boards))
    if (!isQuestion(nodes, q)) delete s.boards[q];
  for (const n of Object.values(nodes).sort(byOrder))
    if (
      n.kind === "question" &&
      !own(s.boards, n.id) &&
      optionsOf(nodes, n.id).length
    )
      s.boards[n.id] = newBoard(n.id, inferShape(nodes, n.id));

  for (const [q, b] of Object.entries(s.boards)) {
    b.question = q;
    b.rows ??= [];
    b.cells ??= {};
    b.against ??= {};
    b.assumptions ??= [];
    b.steps ??= [];
    b.criteriaTouched ??= false;
    const opts = optionsOf(nodes, q);
    const optIds = new Set(opts.map((o) => o.id));
    const seen = new Set<string>();
    b.rows = b.rows.filter((r) => {
      const n = own(nodes, r.id);
      const ok = !!n && n.kind === "fact" && n.parent === q && !seen.has(r.id);
      seen.add(r.id);
      return ok;
    });
    const rowIds = new Set(b.rows.map((r) => r.id));
    for (const key of Object.keys(b.cells)) {
      const [o, r, extra] = key.split("|");
      if (extra !== undefined || !optIds.has(o) || !rowIds.has(r))
        delete b.cells[key];
    }
    for (const o of Object.keys(b.against))
      if (!optIds.has(o)) delete b.against[o];
    if (b.lean && !optIds.has(b.lean.option)) delete b.lean;
    if (b.keepAsIs && !optIds.has(b.keepAsIs)) delete b.keepAsIs;
    if (!b.keepAsIs) {
      const k = opts.find((o) => KEEP_AS_IS.test(o.title));
      if (k) b.keepAsIs = k.id;
    }
    if (
      b.commit &&
      (!optIds.has(b.commit.option) ||
        nodes[b.commit.option].status !== "chosen")
    )
      dropCommit(b);
    // older maps kept Claude's after for an earlier choice when the choice
    // changed: what it wrote before this choice was made is about another
    if (b.commit) {
      const at = b.commit.at;
      b.assumptions = b.assumptions.filter((a) => a.by === "you" || a.at >= at);
      b.steps = b.steps.filter((x) => x.by === "you" || (x.at ?? at) >= at);
    }
    // an option chosen before boards existed is a choice made, with no why
    const chosen = opts.find((o) => o.status === "chosen");
    if (b.shape === "choose" && !b.commit && chosen)
      b.commit = {
        option: chosen.id,
        why: "",
        at: chosen.updatedAt,
        migrated: true,
        premortem: { claude: [] },
      };
  }

  for (const [q, st] of Object.entries(s.stand)) {
    if (!isQuestion(nodes, q)) delete s.stand[q];
    else if (
      st.lead !== null &&
      !optionsOf(nodes, q).some((o) => o.id === st.lead)
    )
      st.lead = null;
  }
  // an older map's lead was an option summary starting "Recommended:"
  for (const n of Object.values(nodes).sort(byOrder)) {
    if (n.kind !== "question" || own(s.stand, n.id)) continue;
    const rec = optionsOf(nodes, n.id).find(
      (o) => inPlay(o) && /^\s*recommended:/i.test(o.summary),
    );
    if (rec)
      s.stand[n.id] = {
        lead: rec.id,
        line: rec.summary.replace(/^\s*recommended:\s*/i, ""),
        at: rec.updatedAt,
        migrated: true,
      };
  }
  for (const q of Object.keys(s.answers))
    if (!isQuestion(nodes, q)) delete s.answers[q];
  for (const id of Object.keys(s.takeaways))
    if (!own(nodes, id)) delete s.takeaways[id];
  for (const id of Object.keys(s.added))
    if (!own(nodes, id)) delete s.added[id];
  return s;
}

// The state as stored, brought in line first (for actions and the model's ops).
export function live(map: {
  nodes: Nodes;
  data?: Record<string, unknown>;
}): ExploreState {
  map.data ??= {};
  const s = reconcile(map.data[PLUGIN_ID], map.nodes);
  map.data[PLUGIN_ID] = s;
  return s;
}

// The state brought in line on a copy: reading a map never writes to it.
export const peek = (map: {
  nodes: Nodes;
  data?: Record<string, unknown>;
}): ExploreState => reconcile(map.data?.[PLUGIN_ID], map.nodes);

// A choice undone or changed: Claude's pre-mortem, assumptions and steps were
// about that option, so they go with it; yours stay, since only you remove
// what you wrote.
export function dropCommit(b: Board) {
  delete b.commit;
  b.assumptions = b.assumptions.filter((a) => a.by === "you");
  b.steps = b.steps.filter((x) => x.by === "you");
}

// Who added an option: core marks the options you choose or set aside as
// yours, which keeps Claude off them, so "you" on a column reads from here.
export const addedBy = (s: ExploreState, n: MapNode): "you" | "claude" =>
  own(s.added, n.id) ? "you" : "claude";

export function ensureBoard(s: ExploreState, nodes: Nodes, q: string): Board {
  s.boards[q] ??= newBoard(q, inferShape(nodes, q));
  return s.boards[q];
}

// ---------------------------------------------------------------- cells

// The mark the board shows: yours wins; Claude's with no fact behind it, or
// one it is unsure of, is a guess.
export function shown(cell: Cell | undefined): ShownCell | null {
  if (cell?.you)
    return {
      mark: cell.you.mark,
      note: cell.you.note,
      facts: cell.you.facts,
      guess: false,
      who: "you",
      ...(cell.claude ? { claude: cell.claude } : {}),
    };
  if (cell?.claude)
    return {
      mark: cell.claude.mark,
      note: cell.claude.note,
      facts: cell.claude.facts,
      guess: cell.claude.sure === "low" || !cell.claude.facts.length,
      who: "claude",
    };
  return null;
}

export const keptRows = (b: Board) => b.rows.filter((r) => !r.suggested);

// The options in board order: keep-as-is first.
export function columnsOf(nodes: Nodes, b: Board): MapNode[] {
  const opts = optionsOf(nodes, b.question);
  const keep = opts.filter((o) => o.id === b.keepAsIs);
  return [...keep, ...opts.filter((o) => o.id !== b.keepAsIs)];
}

// A choice is made on its own board once an option is chosen and none is left
// proposed beside it (what is under it may still be open).
export function chosenHere(nodes: Nodes, q: string): boolean {
  const opts = optionsOf(nodes, q);
  return (
    opts.some((o) => o.status === "chosen") &&
    !opts.some((o) => o.status === "proposed")
  );
}

// Claude's lead on a question, if that option is still in the running.
export function liveLead(s: ExploreState, nodes: Nodes, q: string) {
  const lead = own(s.stand, q)?.lead;
  const n = lead ? own(nodes, lead) : undefined;
  return n && n.parent === q && !n.dropped && n.status !== "dropped"
    ? n
    : undefined;
}

type Hole = { option: string; want: string; guess: boolean };
// Empty or guess cells on the given rows, over the options still in play,
// most worth filling first: the lead's column, then empty cells before
// guesses. A column that already fails a must is out, so its other cells
// are no gap: filling them cannot change the choice. With `rechecks` off
// (Next), a guess Claude already checked on its own is left out until a
// fact newer than its mark is on the board: asking again would only get the
// same answer, for another paid move.
function holes(
  s: ExploreState,
  nodes: Nodes,
  b: Board,
  weight: Weight,
  { guesses = true, rechecks = true } = {},
): Hole[] {
  const lead = liveLead(s, nodes, b.question)?.id;
  const t = tally(b, nodes);
  const cols = columnsOf(nodes, b).filter(
    (o) => inPlay(o) && !t[o.id]?.failsMust,
  );
  const rowIds = new Set(b.rows.map((r) => r.id));
  const facts = rechecks
    ? []
    : [...subtree(nodes, b.question)]
        .map((id) => nodes[id])
        .filter((n) => n?.kind === "fact" && !rowIds.has(n.id));
  const settledGuess = (side: Side) =>
    !!side.checked &&
    !facts.some((f) => f.updatedAt > side.at && !side.facts.includes(f.id));
  const out: Hole[] = [];
  for (const o of cols)
    for (const r of keptRows(b).filter((x) => x.weight === weight)) {
      const cell = own(b.cells, cellKey(o.id, r.id));
      const sc = shown(cell);
      if (!sc) out.push({ option: o.id, want: r.id, guess: false });
      else if (
        guesses &&
        sc.guess &&
        (rechecks || !cell?.claude || !settledGuess(cell.claude))
      )
        out.push({ option: o.id, want: r.id, guess: true });
    }
  // a stable sort: column order holds within each rank
  const rank = (h: Hole) => (h.option === lead ? 0 : 2) + Number(h.guess);
  return out.sort((a, c) => rank(a) - rank(c));
}

// The cells a Fill asks for, in the order to write them: every empty cell on
// a must, then on what matters, then nice, each want across the options, at
// most FILL_MAX. The server lists them: told only "musts first", Claude
// filled what matters on some options while musts stayed empty on others.
export const FILL_MAX = 24;
export function fillCells(s: ExploreState, nodes: Nodes, b: Board) {
  const row = new Map(b.rows.map((r, i) => [r.id, i]));
  const col = new Map(columnsOf(nodes, b).map((o, i) => [o.id, i]));
  const all = WEIGHTS.flatMap((w) =>
    holes(s, nodes, b, w, { guesses: false }).sort(
      (a, c) =>
        row.get(a.want)! - row.get(c.want)! ||
        col.get(a.option)! - col.get(c.option)!,
    ),
  );
  return { cells: all.slice(0, FILL_MAX), left: all.length - FILL_MAX };
}

// ---------------------------------------------------------------- fold, tally

// Rows grouped by weight. Musts never fold; past `max` rows NICE folds to a
// count, then MATTERS, unless you opened that group. A group of one row is
// never folded: its count line takes the same room, so it would hide the
// want and save nothing.
export function fold(
  rows: RowView[],
  cells: Record<string, Cell>,
  liveOptions: string[],
  open: Iterable<Weight> = [],
  max = 8,
): GroupView[] {
  const opened = new Set(open);
  const groups: GroupView[] = WEIGHTS.map((weight) => {
    const rs = rows.filter((r) => r.weight === weight);
    const gap = rs.some((r) =>
      liveOptions.some((o) => {
        const sc = shown(own(cells, cellKey(o, r.id)));
        return !sc || sc.guess;
      }),
    );
    return { weight, rows: rs, folded: false, gap };
  }).filter((g) => g.rows.length);
  const shownRows = () =>
    groups.reduce((a, g) => a + (g.folded ? 1 : g.rows.length), 0);
  if (rows.length > max)
    for (const w of ["nice", "matters"] as const) {
      const g = groups.find((x) => x.weight === w);
      if (g && g.rows.length > 1 && !opened.has(w) && shownRows() > max)
        g.folded = true;
    }
  return groups;
}

// Counts per column, never weights or totals: musts met (a must is met when
// its shown mark is better or same), then each mark.
export function tally(b: Board, nodes: Nodes): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  for (const o of optionsOf(nodes, b.question)) {
    const t: Tally = {
      mustsMet: 0,
      musts: 0,
      better: 0,
      same: 0,
      worse: 0,
      fails: 0,
      unknown: 0,
      empty: 0,
      mustsFailed: 0,
      failsMust: false,
    };
    for (const r of keptRows(b)) {
      const sc = shown(own(b.cells, cellKey(o.id, r.id)));
      if (r.weight === "must") {
        t.musts++;
        if (!sc) t.empty++;
        else if (sc.mark === "better" || sc.mark === "same") t.mustsMet++;
        if (sc?.mark === "fails") {
          t.mustsFailed++;
          t.failsMust = true;
        }
      }
      if (sc) t[sc.mark]++;
    }
    out[o.id] = t;
  }
  return out;
}

// ---------------------------------------------------------------- roll-up

// Is a question settled? A choice once an option is chosen with none left
// proposed; a cause only when you settle it; an open question once answered
// with no option left proposed under it. And, except for causes, only when
// every question under it is settled too.
export function rollup(s: ExploreState, nodes: Nodes): Rollup {
  const qs = Object.values(nodes)
    .filter((n) => n.kind === "question")
    .sort(
      (a, b) =>
        depthOf(nodes, a.id) - depthOf(nodes, b.id) || a.order - b.order,
    );
  const memo = new Map<string, boolean>();
  const under = (q: string) =>
    [...subtree(nodes, q)].filter((id) => id !== q && isQuestion(nodes, id));
  const settled = (q: string): boolean => {
    const hit = memo.get(q);
    if (hit !== undefined) return hit;
    memo.set(q, false); // a cycle never settles
    const shape = shapeOf(s, nodes, q);
    const opts = optionsOf(nodes, q);
    const proposed = opts.some((o) => o.status === "proposed");
    let ok: boolean;
    if (shape === "causes") ok = own(s.answers, q)?.by === "you";
    else if (shape === "choose")
      ok = chosenHere(nodes, q) && under(q).every(settled);
    else
      ok =
        (!!own(s.answers, q) || nodes[q].status === "answered") &&
        !proposed &&
        under(q).every(settled);
    memo.set(q, ok);
    return ok;
  };
  const points: DecisionPoint[] = qs.map((n) => {
    const shape = shapeOf(s, nodes, n.id);
    const aside = pathTo(nodes, n.id)
      .slice(0, -1)
      .reverse()
      .find(
        (a) => a.dropped || (a.kind === "option" && a.status === "dropped"),
      );
    return {
      id: n.id,
      title: n.title,
      shape,
      depth: depthOf(nodes, n.id),
      settled: settled(n.id),
      open: openHere(s, nodes, n.id, shape),
      ...(aside ? { underAside: aside.title } : {}),
    };
  });
  const done = points.filter((p) => p.settled).length;
  const root = rootOf(nodes);
  let state: Rollup["state"] = "open";
  if (points.length && done === points.length) state = "decided";
  else if (root?.kind === "question") {
    const shape = shapeOf(s, nodes, root.id);
    const lean =
      !!liveLead(s, nodes, root.id) ||
      (shape === "choose" &&
        optionsOf(nodes, root.id).some((o) => o.status === "chosen")) ||
      (shape === "causes" && own(s.answers, root.id)?.by === "you") ||
      (shape === "open" && !openHere(s, nodes, root.id, shape));
    if (lean) state = "leaning";
  }
  return { state, settled: done, total: points.length, points };
}

// Open on its own, whatever is under it: a choice with nothing chosen or
// options still proposed; a cause list with nothing marked likely and no
// answer of yours; an open question with no answer.
function openHere(
  s: ExploreState,
  nodes: Nodes,
  q: string,
  shape: Shape,
): boolean {
  const opts = optionsOf(nodes, q);
  if (shape === "choose") return !chosenHere(nodes, q);
  if (shape === "causes")
    return (
      own(s.answers, q)?.by !== "you" &&
      !opts.some((o) => o.status === "chosen")
    );
  return (
    (!own(s.answers, q) && nodes[q].status !== "answered") ||
    opts.some((o) => o.status === "proposed")
  );
}

// ---------------------------------------------------------------- open list

// What is still open, at most 4 items, most important first. Computed here,
// never taken from the model, so it cannot drift from the board.
export function openItems(
  s: ExploreState,
  nodes: Nodes,
  roll = rollup(s, nodes),
): OpenItem[] {
  const root = rootOf(nodes)?.id;
  const items: OpenItem[] = [];
  const add = (
    kind: OpenItem["kind"],
    found: string[],
    label: (n: number) => string,
  ) => {
    if (found.length)
      items.push({
        kind,
        count: found.length,
        label: label(found.length),
        q: found[0],
      });
  };
  const undecided = Object.values(s.boards).filter(
    (b) => b.shape === "choose" && !chosenHere(nodes, b.question),
  );
  // counted in cells, and said so: "4 empty musts" read as 4 missing wants
  // when it was 1 must across 4 options
  const empty: Hole[] = [];
  const guess: Hole[] = [];
  const qOf = new Map<Hole, string>();
  for (const b of undecided)
    for (const h of holes(s, nodes, b, "must")) {
      qOf.set(h, b.question);
      (h.guess ? guess : empty).push(h);
    }
  const onMusts = (hs: Hole[]) => {
    const musts = new Set(hs.map((h) => h.want)).size;
    return musts === 1 ? "on 1 must" : `on ${musts} musts`;
  };
  add(
    "empty-must",
    empty.map((h) => qOf.get(h)!),
    (n) => `${plural(n, "empty cell")} ${onMusts(empty)}`,
  );
  add(
    "guess-must",
    guess.map((h) => qOf.get(h)!),
    (n) => `${plural(n, "guess", "guesses")} ${onMusts(guess)}`,
  );
  const choices = roll.points.filter(
    (p) => p.shape === "choose" && p.open && p.id !== root,
  );
  add(
    "choice",
    choices.map((p) => p.id),
    (n) => plural(n, "choice"),
  );
  const questions = roll.points.filter(
    (p) => p.shape !== "choose" && !p.settled,
  );
  const hidden = questions.filter((p) => p.underAside).length;
  add(
    "question",
    questions.map((p) => p.id),
    (n) =>
      `${plural(n, "question")}${hidden ? ` (${hidden} under a set-aside option)` : ""}`,
  );
  const noAgainst = undecided
    .filter((b) => {
      const lead = liveLead(s, nodes, b.question);
      return lead && !own(b.against, lead.id)?.length;
    })
    .map((b) => b.question);
  // the line is read beside the root's lead: one on a choice below names it
  add("no-against", noAgainst, (n) =>
    n > 1
      ? `${n} leads with no case against`
      : noAgainst[0] === root
        ? "no case against the lead"
        : `${named(nodes, noAgainst[0])}: no case against its lead`,
  );
  add(
    "no-premortem",
    Object.values(s.boards)
      .filter(
        (b) =>
          b.commit &&
          !b.commit.premortem.claude.length &&
          !b.commit.premortem.you,
      )
      .map((b) => b.question),
    (n) => (n === 1 ? "no pre-mortem yet" : `${n} choices with no pre-mortem`),
  );
  add(
    "broken",
    Object.values(s.boards).flatMap((b) =>
      b.assumptions.filter((a) => a.status === "broken").map(() => b.question),
    ),
    (n) => (n === 1 ? "1 assumption broke" : `${n} assumptions broke`),
  );
  return items.slice(0, OPEN_MAX);
}

// The newest change on a question's board: a cell, a case against, an option
// or a want node, the commit.
export function newestChange(s: ExploreState, nodes: Nodes, q: string): number {
  const b = own(s.boards, q);
  let t = 0;
  for (const n of optionsOf(nodes, q)) t = Math.max(t, n.updatedAt);
  if (!b) return t;
  for (const r of b.rows) t = Math.max(t, own(nodes, r.id)?.updatedAt ?? 0);
  for (const c of Object.values(b.cells))
    t = Math.max(t, c.you?.at ?? 0, c.claude?.at ?? 0);
  for (const list of Object.values(b.against))
    for (const a of list) t = Math.max(t, a.at);
  return Math.max(t, b.commit?.at ?? 0);
}

// A cell or a case against written on the board after `t`: new evidence.
export function changedSince(b: Board, t: number): boolean {
  for (const c of Object.values(b.cells))
    if ((c.you?.at ?? 0) > t || (c.claude?.at ?? 0) > t) return true;
  return Object.values(b.against).some((l) => l.some((a) => a.at > t));
}

export const isStale = (s: ExploreState, nodes: Nodes, q: string): boolean => {
  const st = own(s.stand, q);
  return !!st && st.at < newestChange(s, nodes, q);
};

// ---------------------------------------------------------------- Next

// Next's label for one cell: the server knows an ask by it, so a second
// press while that ask waits or runs pays for nothing
export const checkLabel = (nodes: Nodes, option: string, want: string) =>
  `Check ${named(nodes, option)} on ${own(nodes, want)?.title ?? want}`;

// The checks still to run on a question (and under its options): Next names
// them, so Claude picks one to run rather than adding one that repeats them.
export const checksOn = (nodes: Nodes, q: string): MapNode[] =>
  [...subtree(nodes, q)]
    .map((id) => nodes[id])
    .filter((n) => n && !n.dropped && isCheck(n))
    .sort(byOrder);

// What Next will do, and why: the board you are on first, then the map.
export function nextGap(
  s: ExploreState,
  nodes: Nodes,
  current?: string | null,
): Gap {
  const root = rootOf(nodes);
  const q = current && own(s.boards, current) ? current : (root?.id ?? "");
  const b = own(s.boards, q);
  if (b && b.shape === "choose" && !chosenHere(nodes, q)) {
    const cols = columnsOf(nodes, b).filter(inPlay);
    const anyCell = Object.values(b.cells).some((c) => c.you || c.claude);
    if (b.rows.length && !anyCell)
      return {
        kind: "fill",
        q,
        label: "Fill the board",
        reason: "Claude judges each option on what you want",
      };
    const keep = b.keepAsIs ? own(nodes, b.keepAsIs) : undefined;
    if (cols.length < 2 || !keep || !inPlay(keep))
      return {
        kind: "something",
        q,
        label: "Add another option",
        reason:
          cols.length < 2
            ? "a choice with one option fails far more often"
            : "there is no keep-things-as-they-are option to weigh against",
      };
    const must = holes(s, nodes, b, "must", { rechecks: false })[0];
    if (must)
      return {
        kind: "ask",
        q,
        option: must.option,
        want: must.want,
        label: checkLabel(nodes, must.option, must.want),
        reason: must.guess ? "a must, only a guess" : "a must, still empty",
      };
    const lead = liveLead(s, nodes, q);
    const lean = b.lean && own(nodes, b.lean.option);
    for (const o of [lead, lean && inPlay(lean) ? lean : undefined])
      if (o && !own(b.against, o.id)?.length)
        return {
          kind: "against",
          q,
          option: o.id,
          label: `Strongest case against ${named(nodes, o.id)}`,
          reason: "before you choose",
        };
    const matters = holes(s, nodes, b, "matters", { guesses: false })[0];
    if (matters)
      return {
        kind: "ask",
        q,
        option: matters.option,
        want: matters.want,
        label: checkLabel(nodes, matters.option, matters.want),
        reason: "it matters, still empty",
      };
  }
  if (b?.commit && !b.commit.premortem.claude.length)
    return {
      kind: "wrap",
      q,
      option: b.commit.option,
      label: `Pre-mortem on ${named(nodes, b.commit.option)}`,
      reason: "how it could fail, what it rests on, and the first steps",
    };
  // elsewhere, shallowest first, so Next never goes deeper on a settled
  // branch while a choice above is open; set-aside branches wait
  const points = rollup(s, nodes).points.filter((p) => !p.underAside);
  const choice = points.find(
    (p) => p.open && p.shape === "choose" && p.id !== q,
  );
  if (choice)
    return {
      kind: "question",
      q: choice.id,
      label: `Open choice: ${choice.title}`,
      reason: "the highest choice still open",
    };
  // a cause marked likely is not an answer: a causes question stays open
  // until you settle it, so it stays Next's work until then
  const question =
    points.find((p) => p.shape !== "choose" && p.open) ??
    points.find((p) => p.shape === "causes" && !p.settled);
  if (question) {
    const likely = optionsOf(nodes, question.id).filter(
      (o) => o.status === "chosen",
    );
    // with checks on the map, the deciding step is to run one of them, not
    // to add another that repeats it
    const checks = checksOn(nodes, question.id).length;
    if (question.shape === "causes")
      return {
        kind: "question",
        q: question.id,
        label: likely.length
          ? `Confirm ${named(nodes, likely[0].id)}, then settle it`
          : checks
            ? `Which check to run first: ${question.title}`
            : `Tell the causes apart: ${question.title}`,
        reason: likely.length
          ? "you marked it likely; a fact that confirms it lets you settle the question"
          : checks
            ? `${plural(checks, "check")} on the map; Claude picks the one that best splits the causes`
            : "Claude looks for the fact that best splits the causes",
      };
    return {
      kind: "question",
      q: question.id,
      label: `Open question: ${question.title}`,
      reason: "the highest question still open",
    };
  }
  return {
    kind: "sum",
    q: root?.id ?? q,
    label: "Sum up where it stands",
    reason: "nothing is open",
  };
}

// ---------------------------------------------------------------- the model's ops

export const BOARD_OPS = new Set([
  "frame",
  "want",
  "cell",
  "against",
  "stand",
  "takeaway",
  "move",
  "premortem",
  "assume",
  "step",
]);

// The board a want row is on, when the row is kept (never a suggestion).
function boardOfRow(s: ExploreState, want: string, kept = true) {
  return Object.values(s.boards).find((b) =>
    b.rows.some((r) => r.id === want && (!kept || !r.suggested)),
  );
}

// What a side thread may write: one pinned to an option writes that option's
// column (and another column's cell that cites a fact filed under it), its
// case against and takeaway, and its board's stand; one pinned to
// a want writes that row and its board's stand; any other writes takeaways
// and moves within its node. Framing and wants are never a thread's.
function threadAllows(
  s: ExploreState,
  nodes: Nodes,
  scope: string,
  op: Raw,
): boolean {
  const node = own(nodes, scope);
  if (!node) return false;
  const inside = subtree(nodes, scope);
  const isWant = !!boardOfRow(s, scope, false);
  const isOption = node.kind === "option";
  switch (op.op) {
    case "cell": {
      if (isWant) return op.want === scope;
      if (!isOption) return false;
      if (op.option === scope) return true;
      // what you tell an option's thread about yourself (budget, how long you
      // stay) is filed there as a fact, and bears on every option: the thread
      // may judge another column of its board on it, citing it
      const other = own(nodes, String(op.option ?? ""));
      return (
        other?.kind === "option" &&
        other.parent === node.parent &&
        factsOf(nodes, op.facts).some((f) => f !== scope && inside.has(f))
      );
    }
    case "against":
      return isOption && op.option === scope;
    case "stand":
      return (isOption || isWant) && op.q === node.parent;
    case "takeaway":
      return inside.has(String(op.node ?? ""));
    case "move":
      return (
        !isOption &&
        !isWant &&
        inside.has(String(op.id ?? "")) &&
        inside.has(String(op.parent ?? ""))
      );
    default:
      return false;
  }
}

// One of the model's board ops, cleaned field by field: how many things it
// changed, 0 when refused, or null when it is not a board op (core's then).
export function applyExploreOp(
  s: ExploreState,
  nodes: Nodes,
  op: Raw,
  { scope = null as string | null, now = Date.now() } = {},
): number | null {
  if (!op || typeof op !== "object" || !BOARD_OPS.has(op.op)) return null;
  if (scope && !threadAllows(s, nodes, scope, op)) return 0;
  switch (op.op) {
    case "frame": {
      const q = idOf(op.q);
      const shape = oneOf(SHAPES, op.shape);
      if (!q || !shape || !isQuestion(nodes, q)) return 0;
      const b = ensureBoard(s, nodes, q);
      if (b.shapeBy === "you") return 0;
      b.shape = shape;
      const keep = idOf(op.keepAsIs);
      if (
        shape === "choose" &&
        keep &&
        optionsOf(nodes, q).some((o) => o.id === keep)
      )
        b.keepAsIs = keep;
      return 1;
    }
    case "want": {
      const q = idOf(op.q);
      const id = idOf(op.id);
      const weight = oneOf(WEIGHTS, op.weight);
      const title = clip(op.title, 6, 60);
      if (!q || !id || !weight || !isQuestion(nodes, q)) return 0;
      // only a choice weighs options against what you want: on a cause list
      // or an open question a want would be a stray card on the tree
      if (shapeOf(s, nodes, q) !== "choose") return 0;
      const b = ensureBoard(s, nodes, q);
      const row = b.rows.find((r) => r.id === id);
      if (row) {
        // yours, or one you kept, stays as it is
        if (!row.suggested || row.by === "you") return 0;
        row.weight = weight;
        const n = nodes[id];
        if (n.by === "claude") {
          if (title) n.title = title;
          if (WANT_SUMMARY.test(n.summary))
            n.summary = wantSummary(weight, true);
          n.updatedAt = now;
        }
        return 1;
      }
      if (b.rows.length >= ROWS_MAX) return 0;
      const cur = own(nodes, id);
      if (cur) {
        // a fact already under the question that states a want becomes its row
        if (cur.kind !== "fact" || cur.parent !== q || boardOfRow(s, id, false))
          return 0;
      } else {
        if (!title) return 0;
        makeNode(
          nodes,
          {
            id,
            parent: q,
            kind: "fact",
            title,
            summary: wantSummary(weight, true),
            status: "info",
            by: "claude",
          },
          now,
        );
      }
      b.rows.push({ id, weight, suggested: true, by: "claude" });
      return 1;
    }
    case "cell": {
      const option = idOf(op.option);
      const want = idOf(op.want);
      const mark = oneOf(MARKS, op.mark);
      if (!option || !want || !mark) return 0;
      const given = op.sure === undefined ? "mid" : oneOf(SURES, op.sure);
      if (!given) return 0;
      const b = boardOfRow(s, want);
      const o = own(nodes, option);
      if (
        !b ||
        !o ||
        o.kind !== "option" ||
        o.parent !== b.question ||
        o.dropped
      )
        return 0;
      const facts = factsOf(nodes, op.facts);
      const side: Side = {
        mark,
        note: clip(op.note, 12, 100),
        facts,
        sure: facts.length ? given : "low",
        at: now,
        ...(scope ? { checked: true } : {}),
      };
      const key = cellKey(option, want);
      b.cells[key] = { ...own(b.cells, key), claude: side };
      return 1;
    }
    case "against": {
      const option = idOf(op.option);
      const text = clip(op.text, 20, 160);
      const survives: Survives | null =
        op.survives === undefined ? "yes" : oneOf(SURVIVES, op.survives);
      const o = option ? own(nodes, option) : undefined;
      if (!o || o.kind !== "option" || o.dropped || !text || !survives)
        return 0;
      if (!o.parent || !isQuestion(nodes, o.parent)) return 0;
      const b = ensureBoard(s, nodes, o.parent);
      const entry: Against = {
        text,
        survives,
        facts: factsOf(nodes, op.facts),
        at: now,
      };
      b.against[o.id] = [...(own(b.against, o.id) ?? []), entry].slice(
        -AGAINST_KEPT,
      );
      return 1;
    }
    case "stand": {
      const q = idOf(op.q);
      if (!q || !isQuestion(nodes, q)) return 0;
      const id = idOf(op.lead);
      const lead = id ? own(nodes, id) : undefined;
      const sure = Number(op.sure);
      const st: Stand = {
        // only an option still in the running under this question can lead
        lead:
          lead &&
          lead.kind === "option" &&
          lead.parent === q &&
          !lead.dropped &&
          lead.status !== "dropped"
            ? lead.id
            : null,
        line: clip(op.line, 20, 160),
        at: now,
      };
      if (op.sure !== undefined && op.sure !== null && Number.isFinite(sure))
        st.sure = Math.min(100, Math.max(0, Math.round(sure)));
      // Your choice is no evidence: with nothing new on the board since you
      // chose, Claude's lead and how sure it is stay what they were, so
      // "Claude agrees" means it does (the lead may be an option your choice
      // set aside)
      const b = own(s.boards, q);
      const was = own(s.stand, q);
      if (b?.commit && was && !changedSince(b, b.commit.at)) {
        st.lead = was.lead;
        if (was.sure !== undefined) st.sure = was.sure;
        else delete st.sure;
      }
      s.stand[q] = st;
      return 1;
    }
    case "takeaway": {
      const id = idOf(op.node);
      const text = clip(op.text, 14, 120);
      if (!id || !own(nodes, id) || !text) return 0;
      s.takeaways[id] = { text, at: now };
      return 1;
    }
    case "move": {
      const id = idOf(op.id);
      const parent = idOf(op.parent);
      const n = id ? own(nodes, id) : undefined;
      const p = parent ? own(nodes, parent) : undefined;
      if (!n || !p || !n.parent || n.by === "you") return 0;
      if (p.kind === "fact" || subtree(nodes, n.id).has(p.id)) return 0;
      // a want is its board's row: moving it would lose the row
      if (boardOfRow(s, n.id, false)) return 0;
      if (n.parent === p.id) return 0;
      n.parent = p.id;
      n.updatedAt = now;
      return 1;
    }
    case "premortem": {
      const option = idOf(op.option);
      const o = option ? own(nodes, option) : undefined;
      const b = o?.parent ? own(s.boards, o.parent) : undefined;
      if (!b?.commit || b.commit.option !== option) return 0;
      const reasons = list(op.reasons, 3)
        .map((r) => clip(r, 12, 100))
        .filter(Boolean);
      if (!reasons.length) return 0;
      b.commit.premortem.claude = reasons;
      return 1;
    }
    case "assume":
    case "step": {
      const q = idOf(op.q);
      const id = idOf(op.id);
      const b = q ? own(s.boards, q) : undefined;
      if (!b?.commit || !id) return 0;
      if (op.op === "assume") {
        const text = clip(op.text, 14, 120);
        const breaksIf = clip(op.breaksIf, 14, 120);
        const cur = b.assumptions.find((a) => a.id === id);
        // Claude never edits yours, and never says whether one held
        if (cur) {
          if (cur.by === "you") return 0;
          if (text) cur.text = text;
          if (breaksIf) cur.breaksIf = breaksIf;
          return 1;
        }
        if (
          !text ||
          b.assumptions.filter((a) => a.by === "claude").length >= WRAP_MAX
        )
          return 0;
        b.assumptions.push({
          id,
          text,
          breaksIf,
          status: "untested",
          by: "claude",
          at: now,
        });
        return 1;
      }
      const when = clip(op.when, 10, 90);
      const what = clip(op.do, 12, 100);
      const cur = b.steps.find((x) => x.id === id);
      if (cur) {
        if (cur.by === "you") return 0;
        if (when) cur.when = when;
        if (what) cur.do = what;
        return 1;
      }
      if (!what || b.steps.filter((x) => x.by === "claude").length >= WRAP_MAX)
        return 0;
      b.steps.push({ id, when, do: what, by: "claude", at: now });
      return 1;
    }
  }
  return null;
}

// The facts a cell or a case against cites: ids of nodes on the map, at most 4.
function factsOf(nodes: Nodes, v: unknown): string[] {
  const ids = list(v, 20)
    .map(idOf)
    .filter((id): id is string => !!id && !!own(nodes, id));
  return [...new Set(ids)].slice(0, FACTS_PER_CELL);
}

// ---------------------------------------------------------------- outline

const DATE = (t: number) => {
  const d = new Date(t);
  const m = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d.getUTCDate()} ${m[d.getUTCMonth()]}`;
};

// What the model reads about the boards, gaps first so it sees them before the
// filled cells. Your lean, and how sure you are of it, are never in it: Claude's
// lead stays its own.
export function outlineOf(s: ExploreState, nodes: Nodes): string {
  const root = rootOf(nodes)?.id;
  const roll = rollup(s, nodes);
  const depth = (q: string) => roll.points.find((p) => p.id === q)?.depth ?? 0;
  // the root's board, and any board with wants or a choice on it, in full
  const full = Object.values(s.boards)
    .filter(
      (b) =>
        b.question === root ||
        b.rows.length ||
        b.commit ||
        Object.keys(b.cells).length,
    )
    .sort((a, b) => depth(a.question) - depth(b.question));
  const out: string[] = [];
  const allCells = Object.values(s.boards).flatMap((b) =>
    Object.values(b.cells),
  );
  for (const b of full) {
    const q = b.question;
    const cols = columnsOf(nodes, b);
    const t = tally(b, nodes);
    const lead = liveLead(s, nodes, q)?.id;
    const reviewed = b.criteriaTouched || b.rows.some((r) => r.by === "you");
    out.push(
      `BOARD [${q}] ${b.shape}${b.shape === "choose" ? ` · keep-as-is ${b.keepAsIs ? `[${b.keepAsIs}]` : "none"}` : ""} · wants reviewed by user: ${reviewed ? "yes" : "no"}`,
    );
    const kept = keptRows(b);
    out.push(
      `WANTS: ${kept.map((r) => `[${r.id}] ${r.weight} "${nodes[r.id].title}"${r.by === "you" ? " (user)" : ""}`).join(" · ") || "none kept yet"}`,
    );
    const sugg = b.rows.filter((r) => r.suggested);
    if (sugg.length)
      out.push(
        `SUGGESTED, NOT KEPT (do not fill): ${sugg.map((r) => `[${r.id}] "${nodes[r.id].title}"`).join(" · ")}`,
      );
    const fails = (o: string) =>
      kept
        .filter(
          (r) =>
            r.weight === "must" &&
            shown(own(b.cells, cellKey(o, r.id)))?.mark === "fails",
        )
        .map((r) => r.id);
    const live = cols.filter((o) => !asideByYou(o));
    out.push(
      `COLUMNS: ${
        live
          .map((o) =>
            [
              `[${o.id}]`,
              o.id === b.keepAsIs && "keep-as-is",
              o.id === lead && "your lead",
              o.status === "chosen" && "chosen by user",
              o.status === "dropped" && "set aside by the choice",
              addedBy(s, o) === "you" && "added by user",
              t[o.id]?.failsMust && `fails must ${fails(o.id).join(", ")}`,
            ]
              .filter(Boolean)
              .join(" "),
          )
          .join(" · ") || "none"
      } · SET ASIDE BY USER: ${
        cols
          .filter(asideByYou)
          .map((o) => `[${o.id}]`)
          .join(" ") || "none"
      }`,
    );
    if (b.shape === "choose" && !chosenHere(nodes, q)) {
      const gaps = holes(s, nodes, b, "must");
      out.push(
        `EMPTY OR GUESS ON A MUST: ${gaps.map((h) => `${h.option} × ${h.want} ${h.guess ? "guess" : "EMPTY"}`).join(" · ") || "none"}`,
      );
    }
    const cells = Object.entries(b.cells).filter(([, c]) => c.you || c.claude);
    if (cells.length) {
      out.push("CELLS (option × want: mark · note · facts · who):");
      for (const [key, c] of cells) {
        const [o, r] = key.split("|");
        const parts: string[] = [];
        if (c.claude)
          parts.push(
            c.claude.mark,
            c.claude.note ? `"${c.claude.note}"` : "",
            c.claude.facts.length
              ? `[${c.claude.facts.join(", ")}]`
              : "no facts",
            `claude ${c.claude.sure}`,
          );
        if (c.you)
          parts.push(
            `USER SAYS ${c.you.mark}${c.you.note ? ` "${c.you.note}"` : ""}`,
          );
        out.push(`  ${o} × ${r}: ${parts.filter(Boolean).join(" · ")}`);
      }
    }
    const against = Object.entries(b.against).filter(([, l]) => l.length);
    if (against.length)
      out.push(
        `AGAINST: ${against
          .map(([o, l]) => {
            const last = l[l.length - 1];
            const was = l.slice(0, -1).reverse();
            return `${o} "${last.text}" (${last.survives})${was.length ? ` · was: ${was.map((a) => `"${a.text}"`).join(", ")}` : ""}`;
          })
          .join(" · ")}`,
      );
    const c = b.commit;
    if (c) {
      out.push(
        `COMMIT: ${c.option}${c.why ? ` · why "${c.why}"` : ""}${c.sure !== undefined ? ` · user ${c.sure}%` : ""} · ${DATE(c.at)}${c.migrated ? " (chosen before the board)" : ""}${c.outcome ? ` · outcome: ${c.outcome.said}` : ""}`,
      );
      const after = [
        `premortem ${c.premortem.claude.length}${c.premortem.you ? ` + user's "${c.premortem.you}"` : ""}`,
        ...b.assumptions.map(
          (a) =>
            `[${a.id}] ${a.status} "${a.text}"${a.breaksIf ? ` breaks if "${a.breaksIf}"` : ""}${a.by === "you" ? " (user)" : ""}`,
        ),
        ...b.steps.map(
          (x) =>
            `[${x.id}] when "${x.when}" do "${x.do}"${x.done ? " (done)" : ""}${x.by === "you" ? " (user)" : ""}`,
        ),
      ];
      out.push(`AFTER: ${after.join(" · ")}`);
    }
    const st = own(s.stand, q);
    if (st)
      out.push(
        `YOUR LAST STAND: lead ${st.lead ?? "none"} · "${st.line}"${st.sure !== undefined ? ` · ${st.sure}` : ""}${isStale(s, nodes, q) ? " · written before the last change" : ""}`,
      );
    out.push("");
  }
  const fullIds = new Set(full.map((b) => b.question));
  const others = roll.points.filter((p) => !fullIds.has(p.id));
  if (others.length)
    out.push(
      `OTHER QUESTIONS: ${others
        .map((p) => {
          const a = own(s.answers, p.id);
          const proposed = optionsOf(nodes, p.id).filter(
            (o) => o.status === "proposed",
          ).length;
          const state = p.settled
            ? a?.by === "you"
              ? `settled by user: "${a.text}"`
              : "settled"
            : a?.by === "you"
              ? `answered by user: "${a.text}"`
              : p.open
                ? "open"
                : "leaning";
          return `[${p.id}] ${p.shape}${proposed ? `, ${proposed} proposed` : ""}, ${state}${p.underAside ? ` (under set-aside "${p.underAside}")` : ""}`;
        })
        .join(" · ")}`,
    );
  const takeaways = Object.entries(s.takeaways);
  if (takeaways.length)
    out.push(
      `TAKEAWAYS: ${takeaways.map(([id, t]) => `[${id}] "${t.text}"`).join(" · ")}`,
    );
  if (allCells.length) {
    const loose = looseFacts(s, nodes);
    if (loose.length)
      out.push(
        `LOOSE FACTS (back no cell): ${loose
          .slice(0, 8)
          .map((f) => `[${f.id}] "${f.title}"`)
          .join(" · ")}`,
      );
  }
  const text = out.join("\n").trim();
  return text ? `DECISION BOARDS:\n${text}` : "";
}

// Facts that back no cell, are no want and no check still to run: on the
// whole map, or on one choice (under its question, but not under a question
// below it, whose facts are about that one).
export function looseFacts(s: ExploreState, nodes: Nodes, q?: string) {
  const used = new Set(wantIds(s, nodes));
  for (const b of Object.values(s.boards))
    for (const c of Object.values(b.cells))
      for (const f of [...(c.you?.facts ?? []), ...(c.claude?.facts ?? [])])
        used.add(f);
  let within: Set<string> | null = null;
  if (q) {
    within = subtree(nodes, q);
    for (const id of [...within])
      if (id !== q && isQuestion(nodes, id))
        for (const x of subtree(nodes, id)) within.delete(x);
  }
  return Object.values(nodes)
    .filter(
      (n) =>
        n.kind === "fact" &&
        !n.dropped &&
        !used.has(n.id) &&
        !isCheck(n) &&
        (!within || within.has(n.id)),
    )
    .sort(byOrder)
    .map((n) => ({ id: n.id, title: n.title }));
}

// The want nodes: every board's rows, and a want an older map left behind
// when you removed it (its summary still says it is a want), unless
// something hangs under it.
export function wantIds(s: ExploreState, nodes: Nodes): string[] {
  const ids = new Set(
    Object.values(s.boards).flatMap((b) => b.rows.map((r) => r.id)),
  );
  for (const n of Object.values(nodes))
    if (
      n.kind === "fact" &&
      WANT_SUMMARY.test(n.summary) &&
      !Object.values(nodes).some((x) => x.parent === n.id)
    )
      ids.add(n.id);
  return [...ids];
}

// ---------------------------------------------------------------- view

const rowView = (nodes: Nodes, r: Board["rows"][number]): RowView => ({
  id: r.id,
  title: own(nodes, r.id)?.title ?? r.id,
  weight: r.weight,
  by: r.by,
  suggested: r.suggested,
});

// Everything the screen shows, worked out here: the browser does no logic.
export function viewOf(
  s: ExploreState,
  nodes: Nodes,
  threads: Record<string, { nodeId: string }>,
  now = Date.now(),
): ExploreView {
  const root = rootOf(nodes);
  const roll = rollup(s, nodes);
  const point = (q: string) => roll.points.find((p) => p.id === q);
  const threadCount = (id: string) =>
    Object.values(threads).filter((t) => t.nodeId === id).length;
  const boards: Record<string, BoardView> = {};
  for (const b of Object.values(s.boards)) {
    const q = b.question;
    const cols = columnsOf(nodes, b);
    const t = tally(b, nodes);
    // after a Choose, Claude's lead may be an option the choice set aside:
    // it is still Claude's, so its column says so
    const lead =
      liveLead(s, nodes, q)?.id ??
      (b.commit ? (own(s.stand, q)?.lead ?? undefined) : undefined);
    const column = (o: MapNode): ColumnView => {
      const list = own(b.against, o.id) ?? [];
      return {
        id: o.id,
        title: o.title,
        summary: o.summary.replace(/^\s*recommended:\s*/i, ""),
        keepAsIs: o.id === b.keepAsIs,
        lead: o.id === lead,
        lean: b.lean?.option === o.id,
        chosen: o.status === "chosen",
        faded: o.status === "dropped" && !o.dropped,
        failsMust: t[o.id].failsMust,
        by: addedBy(s, o),
        threads: threadCount(o.id),
        ...(own(s.takeaways, o.id) ? { takeaway: s.takeaways[o.id].text } : {}),
        ...(list.length ? { against: list[list.length - 1] } : {}),
        was: list.slice(0, -1).reverse(),
        tally: t[o.id],
      };
    };
    const cells: Record<string, ShownCell> = {};
    for (const [key, c] of Object.entries(b.cells)) {
      const sc = shown(c);
      if (sc) cells[key] = sc;
    }
    boards[q] = {
      question: q,
      title: own(nodes, q)?.title ?? q,
      shape: b.shape,
      shapeBy: b.shapeBy,
      keepAsIs: b.keepAsIs ?? null,
      path: pathTo(nodes, q)
        .filter((n) => n.kind === "question")
        .map((n) => ({ id: n.id, title: n.title })),
      columns: cols.filter((o) => !asideByYou(o)).map(column),
      aside: cols.filter(asideByYou).map(column),
      groups: fold(
        keptRows(b).map((r) => rowView(nodes, r)),
        b.cells,
        cols.filter(inPlay).map((o) => o.id),
      ),
      suggestions: b.rows
        .filter((r) => r.suggested)
        .map((r) => rowView(nodes, r)),
      cells,
      lean: b.lean ?? null,
      commit: b.commit ?? null,
      assumptions: b.assumptions,
      steps: b.steps,
      criteriaTouched: b.criteriaTouched,
      filledAt: b.filledAt ?? null,
      needsWants: b.shape === "choose" && !b.rows.length,
      settled: point(q)?.settled ?? false,
      next: nextGap(s, nodes, q),
      looseFacts: looseFacts(s, nodes, q),
    };
  }
  const stand: ExploreView["stand"] = {};
  for (const [q, st] of Object.entries(s.stand)) {
    const says = boardSays(s, nodes, q);
    stand[q] = {
      ...st,
      stale: isStale(s, nodes, q),
      ...(says ? { boardSays: says } : {}),
    };
  }
  const gapsOn = (q: string) => {
    const b = own(s.boards, q);
    if (!b || chosenHere(nodes, q)) return 0;
    return (["must", "matters", "nice"] as const).reduce(
      (a, w) => a + holes(s, nodes, b, w).length,
      0,
    );
  };
  const questions: QuestionView[] = roll.points.map((p) => {
    const a = own(s.answers, p.id);
    const node = nodes[p.id];
    return {
      id: p.id,
      title: p.title,
      shape: p.shape,
      settled: p.settled,
      board: !!own(s.boards, p.id),
      answer: a
        ? { text: a.text, by: a.by }
        : node.status === "answered" && node.summary
          ? { text: node.summary, by: "claude" }
          : null,
      gaps: gapsOn(p.id),
      ...(p.underAside ? { underAside: p.underAside } : {}),
    };
  });
  const outcomeDue = Object.values(s.boards).flatMap((b) => {
    const c = b.commit;
    if (!c || c.migrated || now - c.at < 7 * DAY) return [];
    if (
      c.outcome &&
      !(c.outcome.said === "too-soon" && now - c.outcome.at >= 7 * DAY)
    )
      return [];
    return [
      {
        q: b.question,
        option: c.option,
        title: own(nodes, c.option)?.title ?? c.option,
        ...(c.sure !== undefined ? { sure: c.sure } : {}),
        at: c.at,
      },
    ];
  });
  return {
    root: root?.id ?? null,
    defaultView:
      root && shapeOf(s, nodes, root.id) === "choose" ? "board" : "tree",
    boards,
    stand,
    rollup: roll,
    open: openItems(s, nodes, roll),
    questions,
    next: nextGap(s, nodes),
    wants: wantIds(s, nodes),
    outcomeDue,
  };
}

// Where the board disagrees with Claude's lead before you choose: the lead
// fails a must, or another option meets more musts. Worked out from the
// cells, so the stand line never backs a column the board scores lower
// without saying so.
export function boardSays(
  s: ExploreState,
  nodes: Nodes,
  q: string,
): string | null {
  const b = own(s.boards, q);
  const lead = liveLead(s, nodes, q);
  if (!b || b.shape !== "choose" || b.commit || !lead) return null;
  const t = tally(b, nodes);
  const mine = t[lead.id];
  if (!mine?.musts) return null;
  if (mine.failsMust) return "the board has it failing a must";
  const best = columnsOf(nodes, b)
    .filter((o) => o.id !== lead.id && inPlay(o) && !t[o.id].failsMust)
    .sort((a, c) => t[c.id].mustsMet - t[a.id].mustsMet)[0];
  if (!best || t[best.id].mustsMet <= mine.mustsMet) return null;
  return `the board has ${named(nodes, best.id)} meeting more musts (${t[best.id].mustsMet}/${mine.musts}, the lead ${mine.mustsMet}/${mine.musts})`;
}

// ---------------------------------------------------------------- summary

// One line for the maps list.
export function summaryOf(s: ExploreState, nodes: Nodes): string {
  const roll = rollup(s, nodes);
  const root = rootOf(nodes);
  const b = root ? own(s.boards, root.id) : undefined;
  const settled = `${roll.settled} of ${roll.total} settled`;
  if (b?.commit) {
    const title = own(nodes, b.commit.option)?.title ?? b.commit.option;
    return `Chose ${title}${b.commit.sure !== undefined ? ` · ${b.commit.sure}%` : ""} · ${settled}`;
  }
  if (b && b.shape === "choose" && keptRows(b).length) {
    const cols = columnsOf(nodes, b).filter(inPlay).length;
    const gaps = WEIGHTS.reduce((a, w) => a + holes(s, nodes, b, w).length, 0);
    return `${plural(cols, "option")} × ${plural(keptRows(b).length, "want")} · ${plural(gaps, "gap")}`;
  }
  const word = { decided: "Decided", leaning: "Leaning", open: "Open" }[
    roll.state
  ];
  return `${word} · ${settled}`;
}
