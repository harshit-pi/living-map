// The board: the options across the top ("Keep things as they are" first, a
// "Something else?" slot always last), what you want down the side grouped
// must / matters / nice, one cell where each meets each, then the case
// against and the tally per option. Every empty slot is drawn, so the board
// shows its own gaps.
//
//   rail 200px │ keep as is │ option … │ strips 48px │ set aside │ something else?
//   ───────────┼────────────┼──────────┼─────────────┼───────────┼────────────────
//   header     │ cells, one line per want …          │  (drawer) │  (spans all)
//   against    │
//   tally      │

import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Cell, CellPopover } from "./Cell.tsx";
import { Btn } from "./ui.tsx";
import { anchorOf, useOpened, type Anchor, type Here } from "./view.ts";
import {
  cellKey,
  MARK_LOOK,
  NAME_MAX,
  WEIGHT_WORD,
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
// how much room is left, once a name nears the limit, so nothing is cut
// without your seeing it
function Left({ text }: { text: string }) {
  if (text.length < NAME_MAX - 20) return null;
  return (
    <span className="text-[11px] text-muted tabular-nums">
      {NAME_MAX - text.length} left
    </span>
  );
}

// the categories people most often leave out of what they want
const MISSED = ["Cost", "Time", "Risk", "People", "Undo", "Regret"];

type Line = {
  key: string;
  rail?: ReactNode;
  cell?: (c: ColumnView) => ReactNode;
  // one cell from the rail to the last option
  span?: ReactNode;
  tone?: "head" | "group" | "foot";
};

// after a Choose, a column that fails a must shrinks to a strip
const isStrip = (c: ColumnView) => c.faded && c.failsMust;

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
  // The board scrolls with its pane (ExploreScreen), both ways, and never
  // on its own: the option names stay pinned on top and the rail on the
  // left. The lines that span the board (the banner, + what else do you
  // want?) stick to the left as it scrolls sideways. A sticky line moves only
  // within its own span, which stops short of the columns after the options
  // (the drawer, "Something else?"): it is kept narrower than the room you
  // see (--pane-w, less what covers it) by their width, so it can follow you
  // to the far right.
  const cols = board.columns;
  const ghost = !board.keepAsIs;
  const aside = board.aside.length > 0;
  const anyCell = Object.keys(board.cells).length > 0;
  const hasRows = board.groups.length > 0 || board.suggestions.length > 0;

  const openCell = (option: string, want: string, at: Anchor) =>
    setPop({ option, want, at });

  const lines: Line[] = [
    {
      key: "head",
      tone: "head",
      rail: (
        <div className="px-3 py-2">
          <div className="line-clamp-3 text-[13px] font-semibold leading-snug text-ink">
            {board.title}
          </div>
          <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
            What you want
          </div>
        </div>
      ),
      cell: (c) => <ColumnHead here={here} board={board} col={c} />,
    },
  ];
  if (board.needsWants)
    lines.push({
      key: "needs",
      span: (
        <div className="flex flex-wrap items-center gap-2 bg-primary-soft px-3 py-2 text-[13px] text-body">
          This board has no list of what you want yet.
          <Btn small primary onClick={() => void act("suggest", { q })}>
            Suggest what to weigh ▸
          </Btn>
        </div>
      ),
    });
  else if (hasRows && !anyCell)
    lines.push({
      key: "frame",
      span: (
        <div className="flex flex-wrap items-center gap-2 bg-primary-soft px-3 py-2 text-[13px] text-body">
          <span>
            Claude suggested what to weigh. Keep, skip or add your own, mark the
            musts, then press <b>Fill the board</b>.
          </span>
          <Btn small primary onClick={() => void act("fill", { q })}>
            Fill the board ▸
          </Btn>
        </div>
      ),
    });

  for (const g of board.groups) {
    const folded = g.folded && !opened.has(g.weight);
    const foldable = g.weight !== "must" && (g.folded || opened.has(g.weight));
    lines.push({
      key: `g-${g.weight}`,
      tone: "group",
      rail: (
        <GroupHead
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
    if (!folded)
      for (const r of g.rows)
        lines.push({
          key: `r-${r.id}`,
          rail: (
            <button
              onClick={() => here.select(r.id)}
              title="Open it: how much it matters, and its thread"
              className="flex w-full items-start justify-between gap-2 px-3 py-1.5 text-left text-[13px] leading-snug text-ink hover:bg-panel"
            >
              <span className="min-w-0">{r.title}</span>
              {r.by === "you" && (
                <span className="shrink-0 text-[10.5px] font-semibold text-muted">
                  you
                </span>
              )}
            </button>
          ),
          cell: (c) => (
            <Cell here={here} board={board} col={c} row={r} onOpen={openCell} />
          ),
        });
  }
  for (const r of board.suggestions)
    lines.push({
      key: `s-${r.id}`,
      rail: (
        <div className="px-3 py-1.5 text-[13px] leading-snug text-muted">
          <button
            onClick={() => here.select(r.id)}
            className="text-left hover:text-ink"
            title="Claude's suggestion: keep it to weigh it, or skip it"
          >
            ┄ {r.title}
          </button>
          <span className="ml-1 whitespace-nowrap text-xs">
            <select
              // Claude's weight shows before you keep it; picking one keeps
              // it at that weight
              value={r.weight}
              onChange={(e) =>
                void act("want", { q, id: r.id, weight: e.target.value })
              }
              title="Claude suggests this weight; pick one to keep it at that weight"
              className="mr-1 cursor-pointer rounded border-0 bg-transparent py-0 pl-0.5 pr-4 text-xs text-muted hover:bg-panel"
            >
              {WEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {WEIGHT_WORD[w].toLowerCase()}
                </option>
              ))}
            </select>
            <button
              onClick={() => void act("want", { q, id: r.id, keep: true })}
              className="text-primary-strong underline-offset-2 hover:underline"
            >
              keep
            </button>
            {" · "}
            <button
              onClick={() => void act("want", { q, id: r.id, keep: false })}
              className="underline-offset-2 hover:underline"
            >
              skip
            </button>
          </span>
        </div>
      ),
      cell: () => (
        <div
          className="h-full px-2 py-1.5 text-[11px] text-faint"
          title="Claude fills no cells on a suggestion until you keep it"
        >
          ┄
        </div>
      ),
    });
  lines.push({
    key: "add",
    span: (
      <AddWant
        here={here}
        q={q}
        // the group you add to stays open, so the want you typed stays on
        // screen when the board grows past the fold
        onAdded={(w) => {
          if (w !== "must" && !opened.has(w)) setOpened(w, true);
        }}
      />
    ),
  });
  lines.push({
    key: "against",
    tone: "foot",
    rail: <FootLabel>Case against</FootLabel>,
    cell: (c) => <AgainstCell here={here} col={c} />,
  });
  lines.push({
    key: "tally",
    tone: "foot",
    rail: <FootLabel>Tally</FootLabel>,
    cell: (c) => <TallyCell here={here} board={board} col={c} />,
  });

  // grid columns: the rail, the stand-in for a missing keep-as-is, the
  // options (strips narrow), the drawer, and "Something else?"
  const template = [
    `${RAIL}px`,
    ...(ghost ? [`${COL}px`] : []),
    ...cols.map((c) => `${isStrip(c) ? STRIP : COL}px`),
    ...(aside ? [`${drawer ? COL : DRAWER}px`] : []),
    `${COL}px`,
  ].join(" ");
  const first = ghost ? 3 : 2;
  // the columns after the options, which the lines that span do not cover
  const trailing = COL + (aside ? (drawer ? COL : DRAWER) : 0);
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
          : "border-b border-line";

  return (
    <div
      // clip, not hidden: it rounds the corners without becoming a scroller
      // of its own, which would pin the option names to the box, not the pane
      className="w-fit overflow-clip rounded-xl border border-line bg-surface"
    >
      <div className="grid w-max" style={{ gridTemplateColumns: template }}>
        {lines.map((l, i) =>
          l.span ? (
            <div
              key={l.key}
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
          ) : (
            [
              <div
                key={`${l.key}-rail`}
                style={at(i + 1, 1)}
                className={`sticky left-0 border-r border-line ${l.tone === "head" ? "top-0 z-30" : "z-10"} ${lineCls(l)} ${l.tone ? "" : "bg-surface"}`}
              >
                {l.rail}
              </div>,
              ...cols.map((c, j) => (
                <div
                  key={`${l.key}-${c.id}`}
                  style={at(i + 1, first + j)}
                  className={`min-w-0 border-r border-line ${l.tone === "head" ? "sticky top-0 z-20" : ""} ${lineCls(l)} ${!l.tone && c.lead && !c.faded ? "bg-primary-soft/30" : ""}`}
                >
                  {isStrip(c)
                    ? l.tone === "head" && (
                        <Strip here={here} board={board} col={c} />
                      )
                    : l.cell?.(c)}
                </div>
              )),
            ]
          ),
        )}
        {ghost && (
          <div
            // the header line only: the lines that span the board run under it
            style={{ gridRow: 1, gridColumn: 2 }}
            className="sticky top-0 z-20 border-r border-dashed border-line-strong bg-canvas p-3"
          >
            <div className="text-[13px] text-muted">
              Keep things as they are
            </div>
            <div className="mt-1 text-[11.5px] leading-snug text-faint">
              Every choice weighs against changing nothing.
            </div>
            <Btn
              small
              onClick={() =>
                void act("option", {
                  q,
                  title: "Keep things as they are",
                  keepAsIs: true,
                })
              }
            >
              + add it
            </Btn>
          </div>
        )}
        {aside && (
          <div
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
        )}
        <div
          style={{ gridRow: `1 / span ${n}`, gridColumn: last }}
          className="border-l border-dashed border-line-strong bg-canvas p-3"
        >
          <SomethingElse here={here} q={q} />
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
  g,
  folded,
  foldable,
  onToggle,
}: {
  g: GroupView;
  folded: boolean;
  foldable: boolean;
  onToggle: () => void;
}) {
  const label = (
    <>
      {WEIGHT_WORD[g.weight]}
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

// a folded group: counts only, per column
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
  const empty = marks.filter((c) => !c).length;
  const parts = (["better", "same", "worse", "fails"] as const)
    .filter((m) => count(m))
    .map((m) => `${count(m)}${MARK_LOOK[m].symbol}`);
  // "?" is Claude's can't-tell, a mark; a cell no one has judged is empty
  if (count("unknown")) parts.push(`${count("unknown")}?`);
  if (empty && !col.faded) parts.push(`${empty} empty`);
  return (
    <div
      className={`px-2 py-1 text-xs text-muted ${col.faded ? "opacity-50" : ""}`}
    >
      {parts.join(" ")}
    </div>
  );
}

function ColumnHead({
  here,
  board,
  col,
}: {
  here: Here;
  board: BoardView;
  col: ColumnView;
}) {
  const greyed = col.faded || (col.failsMust && !col.chosen);
  return (
    <div
      className={`flex h-full flex-col px-2.5 py-2 ${col.chosen ? "border-t-2 border-success bg-success-soft" : ""}`}
    >
      <div className="flex min-h-[18px] flex-wrap items-center gap-x-1.5 text-[10.5px] font-semibold uppercase tracking-wide">
        {col.keepAsIs && <span className="text-muted">Keep as is</span>}
        {col.chosen && <span className="text-success-strong">✓ Chosen</span>}
        {col.lead && (
          <span className="text-primary-strong" title="Claude's lead">
            ★ Claude
          </span>
        )}
        {!col.faded && !col.chosen && (
          <button
            onClick={() =>
              void here.act("lean", {
                q: board.question,
                option: col.lean ? null : col.id,
              })
            }
            title={
              col.lean
                ? "Your lean (kept from Claude). Click to clear it"
                : "Lean towards this one. Claude is not told"
            }
            className={col.lean ? "text-ink" : "text-faint hover:text-ink"}
          >
            {col.lean ? "● your lean" : "○ lean"}
          </button>
        )}
        {/* a Choose marks every option under it as yours: "you" only on a
            live column, where it means you added it */}
        {col.by === "you" && !col.faded && !col.chosen && (
          <span className="text-muted">you</span>
        )}
      </div>
      <button
        onClick={() => here.select(col.id)}
        title="Open it: threads, the case against, set aside"
        className={`mt-0.5 text-left text-[13.5px] font-semibold leading-snug hover:text-primary-strong ${greyed ? "text-muted" : "text-ink"} ${col.faded ? "line-through decoration-line-strong" : ""}`}
      >
        {col.title}
      </button>
      {col.summary && (
        <div
          className={`mt-0.5 line-clamp-3 text-[12px] leading-snug ${greyed ? "text-faint" : "text-body"}`}
          title={col.summary}
        >
          {col.summary}
        </div>
      )}
      <div className="mt-auto pt-1 text-[11.5px] leading-snug text-muted">
        {col.threads > 0 && <span title="Side threads">💬{col.threads}</span>}
        {col.takeaway && (
          <span title="What a thread settled">
            {col.threads > 0 && " · "}“{col.takeaway}”
          </span>
        )}
        {col.failsMust && !col.chosen && (
          <div className="font-medium text-danger-strong">✕ fails a must</div>
        )}
      </div>
    </div>
  );
}

// a faded column that fails a must, as a strip: its name runs down it, and
// hovering says why
function Strip({
  here,
  board,
  col,
}: {
  here: Here;
  board: BoardView;
  col: ColumnView;
}) {
  const fails = board.groups
    .flatMap((g) => g.rows)
    .filter((r) => board.cells[cellKey(col.id, r.id)]?.mark === "fails")
    .map((r) => r.title);
  return (
    <button
      onClick={() => here.select(col.id)}
      title={`${col.title}: fails a must (${fails.join(", ") || "a must"})`}
      className="flex h-full w-full items-start justify-center py-2 text-[12px] text-muted opacity-70 hover:text-ink"
    >
      <span className="[writing-mode:vertical-rl]">{col.title} ✕</span>
    </button>
  );
}

function AgainstCell({ here, col }: { here: Here; col: ColumnView }) {
  if (col.against)
    return (
      <div
        className={`px-2 py-1.5 text-xs leading-snug ${col.faded ? "opacity-50" : ""}`}
      >
        <div className="text-body">{col.against.text}</div>
        <div className="mt-0.5 text-muted">
          survives: {col.against.survives}
          {!col.faded && (
            <>
              {" · "}
              <button
                onClick={() => void here.act("against", { option: col.id })}
                title="Claude makes the case again; this one is kept as history"
                className="underline-offset-2 hover:text-ink hover:underline"
              >
                again
              </button>
            </>
          )}
        </div>
      </div>
    );
  if (col.faded) return <div className="px-2 py-1.5 text-xs text-faint">—</div>;
  // the lead or your lean with no case against is a gap, until you choose
  const gap = (col.lead || col.lean) && !col.chosen;
  return (
    <div className={`px-2 py-1.5 ${gap ? "bg-warning-soft/60" : ""}`}>
      <Btn
        small
        onClick={() => void here.act("against", { option: col.id })}
        title="Claude writes the strongest single reason this is the wrong choice"
      >
        Ask
      </Btn>
      {gap && (
        <div className="mt-1 text-[11px] text-warning-strong">
          before you choose
        </div>
      )}
    </div>
  );
}

function TallyCell({
  here,
  board,
  col,
}: {
  here: Here;
  board: BoardView;
  col: ColumnView;
}) {
  const t = col.tally;
  const counts = (
    [
      [t.better, "▲"],
      [t.same, "＝"],
      [t.worse, "▼"],
      [t.unknown, "?"],
    ] as const
  )
    .filter(([k]) => k)
    .map(([k, s]) => `${k}${s}`)
    // "?" is Claude's can't-tell, a mark; a cell no one has judged yet is
    // counted apart, on every want
    .concat(t.blank && !col.faded ? [`${t.blank} empty`] : [])
    .join(" ");
  return (
    <div className={`px-2 py-1.5 text-xs ${col.faded ? "opacity-50" : ""}`}>
      <div
        className={t.failsMust ? "font-medium text-danger-strong" : "text-ink"}
        // a must marked worse is met less well, not missed: only fails
        // rules an option out
        title={
          t.failsMust
            ? "It misses a must, so it is out"
            : "Musts marked better or meets, of all musts. A must marked worse is weaker than the others, not failed: only ✕ fails rules an option out"
        }
      >
        {t.failsMust
          ? `✕ fails ${t.mustsFailed === 1 ? "a must" : `${t.mustsFailed} musts`}`
          : t.musts
            ? `${t.empty ? "" : "none fails · "}musts ▲＝ ${t.mustsMet}/${t.musts}${t.empty ? ` · ${t.empty} empty` : ""}`
            : "no musts yet"}
      </div>
      {counts && <div className="mt-0.5 text-muted">{counts}</div>}
      {col.chosen ? (
        <div className="mt-1 font-semibold text-success-strong">✓ chosen</div>
      ) : (
        !col.faded &&
        board.shape === "choose" && (
          <div className="mt-1.5">
            <Btn
              small
              primary={col.lead || col.lean}
              onClick={(e) => here.choose(col.id, anchorOf(e.currentTarget))}
            >
              Choose…
            </Btn>
          </div>
        )
      )}
    </div>
  );
}

// "+ what else do you want?", with the categories you have probably missed
function AddWant({
  here,
  q,
  onAdded,
}: {
  here: Here;
  q: string;
  onAdded: (w: Weight) => void;
}) {
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState<Weight>("matters");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="px-3 py-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          // cleared only once it is on the board: a refused want (the board
          // is full, it is there already) stays for you to change
          void here.act("want", { q, title, weight }).then((r) => {
            if (r.error) return;
            onAdded(weight);
            setTitle("");
            // back to the usual weight: a must you meant once would
            // otherwise make the next want a must too
            setWeight("matters");
          });
        }}
        className="flex flex-wrap items-center gap-1.5"
      >
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="+ what else do you want?"
          maxLength={NAME_MAX}
          className="w-56 min-w-0 rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink focus:border-primary focus:outline-none"
        />
        <select
          value={weight}
          onChange={(e) => setWeight(e.target.value as Weight)}
          title="How much it matters"
          className="rounded-md border border-line-strong bg-surface px-1.5 py-1 text-xs text-body"
        >
          {WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {WEIGHT_WORD[w].toLowerCase()}
            </option>
          ))}
        </select>
        <Left text={title} />
        {title.trim() && (
          <button
            type="submit"
            className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-on-primary hover:bg-primary-strong"
          >
            Add
          </button>
        )}
      </form>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted">
        You have probably missed some:
        {MISSED.map((m) => (
          <button
            key={m}
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
    </div>
  );
}

// the slot that is always last: an option of yours, or one more from Claude
function SomethingElse({ here, q }: { here: Here; q: string }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <div>
      <div className="text-[13px] font-medium text-muted">
        ┄ Something else?
      </div>
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
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
            placeholder="Your option, in a few words"
            maxLength={NAME_MAX}
            className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink focus:border-primary focus:outline-none"
          />
          <Left text={title} />
        </form>
      ) : (
        <div className="mt-2">
          <Btn small onClick={() => setAdding(true)}>
            + add yours
          </Btn>
        </div>
      )}
      <button
        onClick={() => void here.act("something", { q })}
        title="Claude adds exactly one option you have probably not thought of"
        className="mt-2 block text-left text-xs text-primary-strong underline-offset-2 hover:underline"
      >
        Ask Claude for one ▸
      </button>
    </div>
  );
}
