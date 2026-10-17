// One cell of the board: an option judged on one thing you want. A mark and
// its word, a short note and how many facts back it; a guess is hatched, your
// own rating has a solid left edge, and an empty cell is a gap you can see,
// with "ask" (Claude writes this one cell) and "rate" (you judge it).

import { Btn, MarkText, Pop, WAIT_TITLE } from "./ui.tsx";
import { anchorOf, type Anchor, type Here } from "./view.ts";
import {
  cellKey,
  MARK_LOOK,
  markWord,
  MARKS,
  type BoardView,
  type ColumnView,
  type RowView,
  type ShownCell,
} from "../shared.ts";

// a guess is hatched in the hint colour, so it never reads as a judged mark
const HATCH = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--color-hint-soft) 0 5px, transparent 5px 10px)",
};

const facts = (n: number) => (n === 1 ? "1 fact" : `${n} facts`);

export function Cell({
  here,
  board,
  col,
  row,
  onOpen,
}: {
  here: Here;
  board: BoardView;
  col: ColumnView;
  row: RowView;
  onOpen: (option: string, want: string, at: Anchor) => void;
}) {
  const sc: ShownCell | undefined = board.cells[cellKey(col.id, row.id)];
  const fade = col.faded ? "opacity-50" : "";
  if (!sc) {
    if (col.faded)
      return <div className={`px-2 py-2 text-xs text-faint ${fade}`}>—</div>;
    // an ask on this cell waits or runs (from here or from Next): said in
    // the cell, so it is not asked again
    const { working, waiting } = here.ws.live;
    const asking = [working, ...waiting].some(
      (t) => t?.nodeId === col.id && t.label.endsWith(` on ${row.title}`),
    );
    if (asking)
      return (
        <div className="flex h-full items-start gap-1 border-l-2 border-dashed border-warning-line bg-warning-soft/50 px-2 py-2 text-xs text-muted">
          <span className="h-2 w-2 shrink-0 translate-y-1 animate-pulse rounded-full bg-primary" />
          Claude is checking…
        </div>
      );
    return (
      <div
        className="flex h-full items-start gap-1 border-l-2 border-dashed border-warning-line bg-warning-soft/50 px-2 py-2 text-xs text-warning-strong"
        title="Still empty: a gap on the board"
      >
        <span aria-hidden>·</span>
        <button
          disabled={here.busy}
          onClick={() => {
            void here.act("ask", { option: col.id, want: row.id });
          }}
          title={
            here.busy
              ? WAIT_TITLE
              : "Claude judges this one cell, in the option's thread"
          }
          className="underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          ask
        </button>
        <span aria-hidden>·</span>
        <button
          onClick={(e) => onOpen(col.id, row.id, anchorOf(e.currentTarget))}
          title="Judge it yourself"
          className="underline-offset-2 hover:underline"
        >
          rate
        </button>
      </div>
    );
  }
  const yours = sc.who === "you";
  const disagree = yours && sc.claude && sc.claude.mark !== sc.mark;
  return (
    <button
      onClick={(e) => onOpen(col.id, row.id, anchorOf(e.currentTarget))}
      style={sc.guess ? HATCH : undefined}
      className={`block h-full w-full px-2 py-1.5 text-left text-xs leading-snug hover:bg-panel ${yours ? "border-l-2 border-ink" : "border-l-2 border-transparent"} ${fade}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <MarkText
          mark={sc.mark}
          must={row.weight === "must"}
          className="text-[12.5px]"
        />
        {sc.guess && (
          <span className="text-[10.5px] font-semibold text-hint-strong">
            guess
          </span>
        )}
        {yours && (
          <span className="text-[10.5px] font-semibold text-ink">you</span>
        )}
      </div>
      {sc.note && <div className="mt-0.5 text-body">{sc.note}</div>}
      {sc.facts.length > 0 && (
        <div className="mt-0.5 text-muted">{facts(sc.facts.length)}</div>
      )}
      {disagree && sc.claude && (
        <div className="mt-0.5 text-faint">
          Claude: {MARK_LOOK[sc.claude.mark].symbol}{" "}
          {markWord(sc.claude.mark, row.weight === "must")}
        </div>
      )}
    </button>
  );
}

const SURE_WORD = { low: "low sure", mid: "mid sure", high: "high sure" };

// The cell popover: your own rating, Claude's beside it, and the facts behind
// it. Opened from a filled cell, or from "rate" on an empty one.
export function CellPopover({
  here,
  board,
  option,
  want,
  at,
  onClose,
}: {
  here: Here;
  board: BoardView;
  option: string;
  want: string;
  at: Anchor;
  onClose: () => void;
}) {
  const nodes = here.ws.map.nodes;
  const sc: ShownCell | undefined = board.cells[cellKey(option, want)];
  const must = board.groups.some(
    (g) => g.weight === "must" && g.rows.some((r) => r.id === want),
  );
  const mine = sc?.who === "you" ? sc.mark : null;
  // Claude's side: the mark shown, or the one beside yours
  const claude = !sc
    ? null
    : sc.who === "claude"
      ? {
          mark: sc.mark,
          note: sc.note,
          sure: sc.guess ? "guess" : null,
          facts: sc.facts,
        }
      : sc.claude
        ? {
            mark: sc.claude.mark,
            note: sc.claude.note,
            sure: SURE_WORD[sc.claude.sure],
            facts: sc.claude.facts,
          }
        : null;
  const because = [...new Set([...(sc?.facts ?? []), ...(claude?.facts ?? [])])]
    .map((id) => nodes[id])
    .filter((n) => !!n);
  const rate = (mark: (typeof MARKS)[number] | null) => {
    void here.act("rate", { option, want, mark });
    onClose();
  };
  return (
    <Pop
      anchor={at}
      width={330}
      onClose={onClose}
      title={
        <>
          {nodes[option]?.title ?? option} <span className="text-faint">×</span>{" "}
          {nodes[want]?.title ?? want}
        </>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted">Yours:</span>
        {MARKS.map((m) => (
          <button
            key={m}
            onClick={() => rate(m)}
            title={markWord(m, must)}
            className={`rounded-md border px-1.5 py-0.5 text-xs ${mine === m ? "border-ink bg-panel font-semibold text-ink" : "border-line-strong text-body hover:border-primary"}`}
          >
            {m === "unknown"
              ? "? can't tell"
              : `${MARK_LOOK[m].symbol} ${markWord(m, must)}`}
          </button>
        ))}
        {mine && (
          <button
            onClick={() => rate(null)}
            className="px-1 text-xs text-muted underline-offset-2 hover:underline"
          >
            clear
          </button>
        )}
      </div>
      {claude && (
        <div className="mb-2 text-xs leading-snug text-body">
          <span className="text-muted">Claude:</span>{" "}
          <MarkText mark={claude.mark} must={must} />
          {claude.sure && <span className="text-muted"> · {claude.sure}</span>}
          {claude.note && <> · “{claude.note}”</>}
        </div>
      )}
      {because.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-muted">Because:</span>
          {because.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                here.select(f.id);
                onClose();
              }}
              className="max-w-full truncate rounded-md border border-line-strong px-1.5 py-0.5 text-left text-xs text-body hover:border-primary"
            >
              {f.title}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Btn
          small
          busy={here.busy}
          onClick={() => {
            void here.act("ask", { option, want });
            onClose();
          }}
        >
          Ask Claude about this cell
        </Btn>
        {mine && sc?.claude && (
          <Btn small onClick={() => rate(null)}>
            Use Claude’s
          </Btn>
        )}
      </div>
    </Pop>
  );
}
