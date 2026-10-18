// The board: the options across the top, what you want down the side grouped
// must have / matters / nice to have (Claude's ideas under them until you
// keep or skip them), one cell where each meets each, then, once the board is
// filled, the case against and the musts met per option. A "+ Option" slot is
// always last. Next (in the header) is the board's one next step: the board
// itself has no filled button.
//
//   rail 200px │ option … │ strips 48px │ set aside │ + Option
//   ───────────┼──────────┼─────────────┼───────────┼──────────
//   header     │ cells, one line per want …          │ (spans all)
//   against    │
//   musts met  │
//
// The header, the rail and the cells are one ARIA grid with roving focus:
// one tab stop, the arrow keys move, Enter (or a click) opens what is there
// (an option's or a want's panel, a cell's popover).

import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { CellBody, CellPopover } from "./Cell.tsx";
import { Btn, NameLeft, WAIT_TITLE } from "./ui.tsx";
import { anchorOf, useOpened, type Anchor, type Here } from "./view.ts";
import {
  cellKey,
  tooLong,
  MARK_LOOK,
  markWord,
  SURVIVES_WORD,
  WEIGHT_HEAD,
  WEIGHTS,
  type BoardView,
  type ColumnView,
  type GroupView,
  type Weight,
} from "../shared.ts";

const RAIL = 200;
const COL = 184;
const STRIP = 48;
const DRAWER = 132;
const ADD = 150;
// the categories people most often leave out of what they want
const MISSED = ["Cost", "Time", "Risk", "People", "Undo", "Regret"];

// A spot the grid's focus can rest on, and what Enter or a click there opens
type Nav = { id: string; open: (el: HTMLElement) => void; label: string };

type Line = {
  key: string;
  rail?: ReactNode;
  cell?: (c: ColumnView) => ReactNode;
  // one cell from the rail to the last option
  span?: ReactNode;
  // a banner's tint is on the whole line, not on what sticks to the left
  // as the board scrolls: that stops short of the last columns
  tone?: "head" | "group" | "foot" | "banner";
  // the line's spots in the grid's roving focus
  navRail?: Nav;
  navCell?: (c: ColumnView) => Nav | undefined;
};

// after a Choose, a column that fails a must shrinks to a strip
const isStrip = (c: ColumnView) => c.faded && c.failsMust;

// the musts an option fails, by name: an option never drops out for a
// reason you cannot see
const failedMusts = (board: BoardView, col: ColumnView) =>
  board.groups
    .filter((g) => g.weight === "must")
    .flatMap((g) => g.rows)
    .filter((r) => board.cells[cellKey(col.id, r.id)]?.mark === "fails")
    .map((r) => r.title);
// what a cell says to a screen reader: its mark in words, and a guess
// (the board shows them as a symbol and hatching)
function cellLabel(
  board: BoardView,
  c: ColumnView,
  want: string,
  title: string,
  weight: Weight,
) {
  const sc = board.cells[cellKey(c.id, want)];
  const said = sc
    ? `${markWord(sc.mark, weight === "must")}${sc.guess ? ", a guess" : ""}`
    : "empty";
  return `${c.title}, ${title}: ${said}`;
}
const FAILS_TITLE =
  "It misses a must, so it is out. If that want is not a must for you, open it and make it matter less.";

export function Board({ here, board }: { here: Here; board: BoardView }) {
  const { ws, act } = here;
  const q = board.question;
  const [pop, setPop] = useState<{
    option: string;
    want: string;
    at: Anchor;
  } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [opened, setOpened] = useOpened(ws.map.id, q);
  // the wants you added or kept while on this board: their group stays open
  // while you are here, so the row you just made never vanishes into a
  // count. Not saved as opened: adding one is no choice to open its group,
  // which then never folded again. A group folds whole or not at all (rows
  // shown under its counts read as a half-folded group).
  const [added, setAdded] = useState<string[]>([]);
  // where the grid's focus rests (its one tab stop)
  const [cur, setCur] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  // The board scrolls with its pane (ExploreScreen), both ways, and never
  // on its own: the option names stay pinned on top and the rail on the
  // left. The lines that span the board (the hint, + Something else you
  // want) stick to the left as it scrolls sideways. A sticky line moves only
  // within its own span, which stops short of the columns after the options
  // (the drawer, + Option): it is kept narrower than the room you see
  // (--pane-w, less what covers it) by their width, so it can follow you to
  // the far right.
  const cols = board.columns;
  const aside = board.aside.length > 0;
  // the case against and the musts met wait for the first Fill: before it
  // they were rows of empty buttons. An older map filled before Fill was
  // recorded counts as filled
  const filled = board.filledAt !== null || !board.needsFill;

  const openCell = (option: string, want: string, at: Anchor) =>
    setPop({ option, want, at });
  const select = (id: string) => () => here.select(id);

  const lines: Line[] = [
    {
      key: "head",
      tone: "head",
      rail: (
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          What you want
        </div>
      ),
      cell: (c) => <ColumnHead board={board} col={c} filled={filled} />,
      navCell: (c) => ({
        id: `col:${c.id}`,
        open: select(c.id),
        label: c.title,
      }),
    },
  ];
  // a first-use hint: it goes once you keep, skip or add a want
  if (
    board.suggestions.length > 0 &&
    !board.criteriaTouched &&
    board.filledAt === null
  )
    lines.push({
      key: "hint",
      tone: "banner",
      span: (
        <div className="px-3 py-2 text-[13px] text-body">
          Skip what doesn't matter to you, add your own, then fill the board.
        </div>
      ),
    });

  for (const g of board.groups) {
    const folded =
      g.folded &&
      !opened.has(g.weight) &&
      !g.rows.some((r) => added.includes(r.id));
    const foldable = g.weight !== "must" && (g.folded || opened.has(g.weight));
    lines.push({
      key: `g-${g.weight}`,
      tone: "group",
      rail: (
        <GroupHead
          head={WEIGHT_HEAD[g.weight]}
          g={g}
          folded={folded}
          foldable={foldable}
          onToggle={() => setOpened(g.weight, folded)}
        />
      ),
      cell: folded
        ? (c) => <FoldedCounts board={board} g={g} col={c} />
        : undefined,
    });
    for (const r of folded ? [] : g.rows)
      lines.push({
        key: `r-${r.id}`,
        rail: (
          <div className="flex w-full items-start justify-between gap-2 px-3 py-1.5 text-left text-[13px] leading-snug text-ink">
            <span className="min-w-0" data-content>
              {r.title}
            </span>
            {r.by === "you" && (
              <span className="shrink-0 text-[10.5px] font-semibold text-muted">
                you
              </span>
            )}
          </div>
        ),
        navRail: { id: `row:${r.id}`, open: select(r.id), label: r.title },
        cell: (c) => (
          <CellBody here={here} board={board} col={c} row={r} filled={filled} />
        ),
        navCell: (c) =>
          c.faded
            ? undefined
            : {
                id: `cell:${cellKey(c.id, r.id)}`,
                open: (el) => openCell(c.id, r.id, anchorOf(el)),
                label: cellLabel(board, c, r.id, r.title, r.weight),
              },
      });
  }
  if (board.suggestions.length > 0)
    lines.push({
      key: "g-ideas",
      tone: "group",
      rail: (
        <div
          className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted"
          title="Claude's suggestions: Fill keeps the ones you do not skip"
        >
          Claude's ideas
        </div>
      ),
    });
  for (const r of board.suggestions)
    lines.push({
      key: `s-${r.id}`,
      rail: (
        <div className="flex items-start justify-between gap-1 px-3 py-1.5 text-[13px] leading-snug text-body">
          <span className="min-w-0">
            <span data-content>{r.title}</span>
            {/* a must decides which options survive: Fill never turns
                Claude's guess into your rule unseen */}
            {r.weight === "must" && (
              <span
                className="ml-1.5 text-[11px] font-medium text-warning-strong"
                title="Options that miss it are ruled out"
              >
                must
              </span>
            )}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void act("want", { q, id: r.id, keep: false });
            }}
            aria-label={`Skip ${r.title}`}
            title="Skip it: Fill keeps the rest"
            className="shrink-0 px-1 text-faint hover:text-ink"
          >
            ✕
          </button>
        </div>
      ),
      navRail: { id: `row:${r.id}`, open: select(r.id), label: r.title },
    });
  lines.push({
    key: "add",
    span: (
      <AddWant
        here={here}
        q={q}
        onAdded={(id) => setAdded((a) => [...a, id])}
      />
    ),
  });
  if (filled) {
    lines.push({
      key: "against",
      tone: "foot",
      rail: <FootLabel>Case against</FootLabel>,
      cell: (c) => <AgainstCell here={here} col={c} />,
    });
    lines.push({
      key: "tally",
      tone: "foot",
      rail: <FootLabel>Musts met</FootLabel>,
      cell: (c) => <TallyCell board={board} col={c} />,
    });
  }

  // the grid's roving focus: the spots, line by line, each with its column
  // (the rail is 0), so up and down keep to the column you are in
  const nav: { nav: Nav; pos: number }[][] = lines
    .map((l) =>
      [
        { nav: l.navRail, pos: 0 },
        ...cols.map((c, j) => ({ nav: l.navCell?.(c), pos: j + 1 })),
      ].filter((x): x is { nav: Nav; pos: number } => !!x.nav),
    )
    .filter((row) => row.length > 0);
  const navAt = (id: string) => {
    for (let r = 0; r < nav.length; r++) {
      const c = nav[r].findIndex((x) => x.nav.id === id);
      if (c >= 0) return { r, c, pos: nav[r][c].pos };
    }
    return null;
  };
  const resting = cur && navAt(cur) ? cur : (nav[0]?.[0]?.nav.id ?? null);
  const move = (e: KeyboardEvent<HTMLElement>, n: Nav) => {
    const at = navAt(n.id);
    if (!at) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      n.open(e.currentTarget);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = step[e.key];
    if (!d && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const r = d ? Math.max(0, Math.min(nav.length - 1, at.r + d[0])) : at.r;
    const row = nav[r];
    // the spot in that line nearest the column you are in
    const near = row.reduce(
      (best, x, i) =>
        Math.abs(x.pos - at.pos) < Math.abs(row[best].pos - at.pos) ? i : best,
      0,
    );
    const c =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? row.length - 1
          : d && d[0] !== 0
            ? near
            : Math.max(0, Math.min(row.length - 1, at.c + (d?.[1] ?? 0)));
    const next = row[c].nav.id;
    setCur(next);
    grid.current
      ?.querySelector<HTMLElement>(`[data-nav="${CSS.escape(next)}"]`)
      ?.focus();
  };
  const navProps = (n: Nav | undefined) =>
    n
      ? {
          "data-nav": n.id,
          tabIndex: n.id === resting ? 0 : -1,
          "aria-label": n.label,
          onFocus: () => setCur(n.id),
          onKeyDown: (e: KeyboardEvent<HTMLElement>) => move(e, n),
          onClick: (e: { currentTarget: HTMLElement }) =>
            n.open(e.currentTarget),
        }
      : {};

  // grid columns: the rail, the options (strips narrow), the drawer, and
  // "+ Option"
  const template = [
    `${RAIL}px`,
    ...cols.map((c) => `${isStrip(c) ? STRIP : COL}px`),
    ...(aside ? [`${drawer ? COL : DRAWER}px`] : []),
    `${ADD}px`,
  ].join(" ");
  const first = 2;
  // the columns after the options, which the lines that span do not cover
  const trailing = ADD + (aside ? (drawer ? COL : DRAWER) : 0);
  const last = first + cols.length + (aside ? 1 : 0);
  const n = lines.length;
  const at = (row: number, col: number, span = 1): CSSProperties => ({
    gridRow: row,
    gridColumn: span > 1 ? `${col} / span ${span}` : col,
  });
  const lineCls = (l: Line) =>
    l.tone === "head"
      ? "bg-surface border-b border-line-strong"
      : l.tone === "group"
        ? "bg-panel border-b border-line"
        : l.tone === "foot"
          ? "bg-surface border-b border-line"
          : l.tone === "banner"
            ? "bg-primary-soft border-b border-line"
            : "border-b border-line";
  const focusCls =
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary";

  return (
    <div
      // clip, not hidden: it rounds the corners without becoming a scroller
      // of its own, which would pin the option names to the box, not the pane
      className="w-fit overflow-clip rounded-xl border border-line bg-surface"
    >
      <div
        ref={grid}
        role="grid"
        aria-label="The board: options across, what you want down"
        className="grid w-max"
        style={{ gridTemplateColumns: template }}
      >
        {lines.map((l, i) =>
          l.span ? (
            <div key={l.key} role="row" className="contents">
              <div
                role="gridcell"
                style={at(i + 1, 1, first - 1 + cols.length)}
                className={lineCls(l)}
              >
                <div
                  className="sticky left-0"
                  style={{
                    maxWidth: `max(calc(var(--pane-w, 100vw) - var(--cover, 16px) - 2px - ${trailing}px), 240px)`,
                  }}
                >
                  {l.span}
                </div>
              </div>
            </div>
          ) : (
            <div key={l.key} role="row" className="contents">
              <div
                role={l.tone === "head" ? "columnheader" : "rowheader"}
                {...navProps(l.navRail)}
                style={at(i + 1, 1)}
                className={`sticky left-0 border-r border-line ${l.tone === "head" ? "top-0 z-30" : "z-10"} ${lineCls(l)} ${l.tone ? "" : "bg-surface"} ${l.navRail ? `cursor-pointer hover:bg-panel ${focusCls}` : ""}`}
              >
                {l.rail}
              </div>
              {cols.map((c, j) => {
                const nv = l.navCell?.(c);
                return (
                  <div
                    key={`${l.key}-${c.id}`}
                    role={l.tone === "head" ? "columnheader" : "gridcell"}
                    {...navProps(nv)}
                    style={at(i + 1, first + j)}
                    className={`min-w-0 border-r border-line ${l.tone === "head" ? "sticky top-0 z-20" : ""} ${lineCls(l)} ${!l.tone && c.lead && !c.faded ? "bg-primary-soft/30" : ""} ${nv ? `cursor-pointer hover:bg-panel ${focusCls}` : ""}`}
                  >
                    {isStrip(c)
                      ? l.tone === "head" && <Strip board={board} col={c} />
                      : l.cell?.(c)}
                  </div>
                );
              })}
            </div>
          ),
        )}
        {aside && (
          <div role="row" className="contents">
            <div
              role="gridcell"
              style={{ gridRow: `1 / span ${n}`, gridColumn: last - 1 }}
              className="border-r border-line bg-canvas p-2"
            >
              <button
                onClick={() => setDrawer(!drawer)}
                className="text-xs font-medium text-muted hover:text-ink"
              >
                Set aside ({board.aside.length}) {drawer ? "◂" : "▸"}
              </button>
              {drawer && (
                <ul className="mt-2 space-y-2">
                  {board.aside.map((c) => (
                    <li key={c.id} className="text-xs">
                      <button
                        onClick={() => here.select(c.id)}
                        className="block text-left text-muted line-through hover:text-ink"
                        data-content
                      >
                        {c.title}
                      </button>
                      <button
                        onClick={() =>
                          void ws.run({ type: "restore", nodeId: c.id })
                        }
                        className="text-primary-strong underline-offset-2 hover:underline"
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div role="row" className="contents">
          <div
            role="gridcell"
            style={{ gridRow: `1 / span ${n}`, gridColumn: last }}
            className="border-l border-dashed border-line-strong bg-canvas p-2.5"
          >
            <AddOption here={here} q={q} keepAsIs={!board.keepAsIs} />
          </div>
        </div>
      </div>
      {pop && (
        <CellPopover
          key={cellKey(pop.option, pop.want)}
          here={here}
          board={board}
          option={pop.option}
          want={pop.want}
          at={pop.at}
          onClose={() => setPop(null)}
        />
      )}
    </div>
  );
}

function FootLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </div>
  );
}

function GroupHead({
  head,
  g,
  folded,
  foldable,
  onToggle,
}: {
  head: string;
  g: GroupView;
  folded: boolean;
  foldable: boolean;
  onToggle: () => void;
}) {
  const label = (
    <>
      {head}
      {foldable && ` (${g.rows.length})`}
      {foldable && (folded ? " ▸" : " ▾")}
      {folded && g.gap && (
        <span
          className="ml-1 text-warning"
          title="A gap is inside: an empty cell or a guess"
        >
          ●
        </span>
      )}
    </>
  );
  const cls =
    "block w-full px-3 py-1 text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted";
  return foldable ? (
    <button onClick={onToggle} className={`${cls} hover:text-ink`}>
      {label}
    </button>
  ) : (
    <div className={cls}>{label}</div>
  );
}

// a folded group: counts only, per column (cells no one has judged are
// left out: an empty one shows when the group is open)
function FoldedCounts({
  board,
  g,
  col,
}: {
  board: BoardView;
  g: GroupView;
  col: ColumnView;
}) {
  const marks = g.rows.map((r) => board.cells[cellKey(col.id, r.id)]);
  const count = (m: keyof typeof MARK_LOOK) =>
    marks.filter((c) => c?.mark === m).length;
  const parts = (["better", "same", "worse", "fails"] as const)
    .filter((m) => count(m))
    .map((m) => `${count(m)}${MARK_LOOK[m].symbol}`);
  // "?" is Claude's can't-tell, a mark
  if (count("unknown")) parts.push(`${count("unknown")}?`);
  return (
    <div
      className={`px-2 py-1 text-xs text-muted ${col.faded ? "opacity-50" : ""}`}
    >
      {parts.join(" ")}
    </div>
  );
}

// An option's head: its name and summary (a click, or Enter, opens its
// panel), ★ on Claude's lead, your lean, and once chosen ✓
function ColumnHead({
  board,
  col,
  filled,
}: {
  board: BoardView;
  col: ColumnView;
  filled: boolean;
}) {
  const greyed = col.faded || (col.failsMust && !col.chosen);
  const fails = failedMusts(board, col);
  return (
    <div
      title="Open it: Choose, the case against, its threads"
      className={`flex h-full flex-col px-2.5 py-2 ${col.chosen ? "border-t-2 border-success bg-success-soft" : ""}`}
    >
      {(col.chosen ||
        (col.lean && !col.faded) ||
        (col.by === "you" && !col.faded && !col.chosen)) && (
        <div className="flex min-h-[16px] flex-wrap items-center gap-x-1.5 text-[11px] font-semibold">
          {col.chosen && <span className="text-success-strong">✓ Chosen</span>}
          {col.lean && !col.faded && !col.chosen && (
            <span className="text-ink" title="Your lean (kept from Claude)">
              ● your lean
            </span>
          )}
          {/* a Choose marks every option under it as yours: "you" only on a
              live column, where it means you added it */}
          {col.by === "you" && !col.faded && !col.chosen && (
            <span className="text-muted">you</span>
          )}
        </div>
      )}
      <span
        className={`block text-[13.5px] font-semibold leading-snug ${greyed ? "text-muted" : "text-ink"} ${col.faded ? "line-through decoration-line-strong" : ""}`}
      >
        {col.lead && (
          <span className="text-primary-strong" title="Claude's lead">
            ★{" "}
          </span>
        )}
        <span data-content>{col.title}</span>
      </span>
      {col.summary && (
        <span
          className={`mt-0.5 line-clamp-3 text-[12px] leading-snug ${greyed ? "text-faint" : "text-body"}`}
          data-content
        >
          {col.summary}
        </span>
      )}
      <div className="mt-auto pt-1 text-[11.5px] leading-snug text-muted">
        {col.threads > 0 && (
          <span title="Messages in its side threads">💬{col.threads}</span>
        )}
        {col.takeaway && (
          <span title="What a thread settled" data-content>
            {col.threads > 0 && " · "}“{col.takeaway}”
          </span>
        )}
        {/* before the musts-met row shows, the head says it */}
        {!filled && col.failsMust && !col.chosen && (
          <div className="font-medium text-danger-strong" title={FAILS_TITLE}>
            ✕ fails: {fails.join(", ") || "a must"}
          </div>
        )}
      </div>
    </div>
  );
}

// a faded column that fails a must, as a strip: its name runs down it, and
// hovering says why
function Strip({ board, col }: { board: BoardView; col: ColumnView }) {
  const fails = failedMusts(board, col);
  return (
    <div
      title={`${col.title}: fails a must (${fails.join(", ") || "a must"})`}
      className="flex h-full w-full items-start justify-center py-2 text-[12px] text-muted opacity-70 hover:text-ink"
    >
      {/* a long name is cut short down the strip (the title has it
          whole): written out in full, it made the sticky header row as
          tall as the name and buried the rows under it */}
      <span
        className="max-h-36 overflow-hidden text-ellipsis whitespace-nowrap [writing-mode:vertical-rl]"
        data-content
      >
        ✕ {col.title}
      </span>
    </div>
  );
}

function AgainstCell({ here, col }: { here: Here; col: ColumnView }) {
  // a case against this option waits or runs (from here, or from Next):
  // said in the cell, as an ask is
  const { working, waiting } = here.ws.live;
  const making = [working, ...waiting].some(
    (m) => m?.nodeId === col.id && /\bcase against\b/i.test(m.label),
  );
  if (col.against && !making)
    return (
      <div
        className={`px-2 py-1.5 text-xs leading-snug ${col.faded ? "opacity-50" : ""}`}
      >
        <div className="text-body" data-content>
          {col.against.text}
        </div>
        <div
          className="mt-0.5 font-medium text-muted"
          title="Whether the option survives this case against it"
        >
          {SURVIVES_WORD[col.against.survives]}
        </div>
      </div>
    );
  if (making)
    return (
      <div className="flex items-start gap-1 px-2 py-1.5 text-xs text-muted">
        <span className="h-2 w-2 shrink-0 translate-y-1 animate-pulse rounded-full bg-primary" />
        Claude is making the case…
      </div>
    );
  // the lead or your lean with no case against is a gap, until you choose;
  // any other option's is asked for in its panel
  const gap = (col.lead || col.lean) && !col.chosen && !col.faded;
  if (!gap) return <div className="px-2 py-1.5 text-xs text-faint">—</div>;
  return (
    <div className="bg-warning-soft/60 px-2 py-1.5">
      <Btn
        small
        busy={here.busy}
        onClick={() => void here.act("against", { option: col.id })}
        title="Claude writes the strongest single reason this is the wrong choice"
      >
        Ask Claude
      </Btn>
      <div className="mt-1 text-[11px] text-warning-strong">
        before you choose
      </div>
    </div>
  );
}

function TallyCell({ board, col }: { board: BoardView; col: ColumnView }) {
  const t = col.tally;
  // the counts behind it, said on hover: "5▲ 1＝" read as a code
  const counts = [
    [t.better, "better"],
    [t.same, "same"],
    [t.worse, "worse"],
    [t.unknown, "can't tell"],
    [t.blank, "empty"],
  ] as const;
  const said = counts
    .filter(([k]) => k)
    .map(([k, w]) => `${k} ${w}`)
    .join(", ");
  const fails = failedMusts(board, col);
  return (
    <div className={`px-2 py-1.5 text-xs ${col.faded ? "opacity-50" : ""}`}>
      {t.failsMust ? (
        <div className="font-medium text-danger-strong" title={FAILS_TITLE}>
          ✕ fails: <span data-content>{fails.join(", ") || "a must"}</span>
        </div>
      ) : (
        <div
          className="text-ink"
          // a must marked worse is met less well, not missed: only fails
          // rules an option out
          title={`Musts marked better or meets, of all musts${said ? ` (${said})` : ""}. Only ✕ fails rules an option out`}
        >
          {t.musts ? `${t.mustsMet} of ${t.musts}` : "—"}
        </div>
      )}
    </div>
  );
}

// "+ Something else you want": the weight, and the categories people often
// miss, show only while you type in it
function AddWant({
  here,
  q,
  onAdded,
}: {
  here: Here;
  q: string;
  onAdded: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState<Weight>("matters");
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className="px-3 py-2"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || tooLong(title)) return;
          // cleared at once, so the next want you type starts empty (cleared
          // only once the server answered, what you typed meanwhile was added
          // to the old text and sent with it); a refused want (the board is
          // full, it is there already) comes back for you to change, unless
          // you have started another
          const sent = { title, weight };
          setTitle("");
          // back to the usual weight: a must you meant once would otherwise
          // make the next want a must too
          setWeight("matters");
          void here.act("want", { q, ...sent }).then((r) => {
            if (r.error) {
              setTitle((now) => now || sent.title);
              return;
            }
            if (r.nodeId) onAdded(r.nodeId);
          });
        }}
        className="flex flex-wrap items-center gap-1.5"
      >
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="+ Something else you want"
          className="w-56 min-w-0 rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink focus:border-primary focus:outline-none"
        />
        {/* without it your own deal-breaker could never be a must */}
        {focused && (
          <select
            value={weight}
            onChange={(e) => setWeight(e.target.value as Weight)}
            title="How much it matters"
            className="rounded-md border border-line-strong bg-surface px-1.5 py-1 text-xs text-body"
          >
            {WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {WEIGHT_HEAD[w]}
              </option>
            ))}
          </select>
        )}
        <NameLeft text={title} />
        {title.trim() && !tooLong(title) && (
          <button
            type="submit"
            className="rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-xs font-medium text-body hover:border-primary hover:text-primary-strong"
          >
            Add
          </button>
        )}
      </form>
      {focused && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted">
          Often missed:
          {MISSED.map((m) => (
            <button
              key={m}
              // keeps the box focused, so the hint stays while you pick
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setTitle(`${m}: `);
                input.current?.focus();
              }}
              className="rounded-full border border-line px-2 py-0.5 hover:border-primary hover:text-ink"
            >
              {m.toLowerCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The slot that is always last: "+ Option", a menu of an option of yours or
// one more from Claude, and "+ Keep as is" while the board has none (every
// choice weighs against changing nothing)
function AddOption({
  here,
  q,
  keepAsIs,
}: {
  here: Here;
  q: string;
  keepAsIs: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <div className="relative">
      <Btn small onClick={() => setMenu(!menu)}>
        + Option
      </Btn>
      {menu && (
        <div className="absolute left-0 top-7 z-40 w-48 rounded-xl bg-surface py-1 shadow-xl ring-1 ring-line">
          <button
            onClick={() => {
              setMenu(false);
              setAdding(true);
            }}
            className="block w-full px-3 py-1.5 text-left text-[13px] text-body hover:bg-panel"
          >
            Your own…
          </button>
          <button
            disabled={here.busy}
            onClick={() => {
              setMenu(false);
              void here.act("something", { q });
            }}
            title={
              here.busy
                ? WAIT_TITLE
                : "Claude adds exactly one option you have probably not thought of"
            }
            className="block w-full px-3 py-1.5 text-left text-[13px] text-body hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask Claude for one
          </button>
        </div>
      )}
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || tooLong(title)) return;
            void here.act("option", { q, title });
            setTitle("");
            setAdding(false);
          }}
          className="mt-2"
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(false);
            }}
            onBlur={() => {
              if (!title.trim()) setAdding(false);
            }}
            placeholder="Your option, in a few words"
            className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink focus:border-primary focus:outline-none"
          />
          <NameLeft text={title} />
        </form>
      )}
      {keepAsIs && (
        <button
          onClick={() =>
            void here.act("option", {
              q,
              title: "Keep things as they are",
              keepAsIs: true,
            })
          }
          title="Every choice weighs against changing nothing"
          className="mt-2 block text-left text-xs text-primary-strong underline-offset-2 hover:underline"
        >
          + Keep as is
        </button>
      )}
    </div>
  );
}
