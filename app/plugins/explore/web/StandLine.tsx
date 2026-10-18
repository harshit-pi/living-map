// Where it stands, pinned above the board or the tree: Claude's lead with
// how sure it is and its line (or your choice, once you made it, with a
// Decided chip), what the board itself says when it disagrees, a ↻ when
// Claude's line is older than the last change, the causes you marked likely,
// the sub-choices to open, and how a choice turned out once it is due. The
// open list and the loose facts are in the header's ⋯ (and the open list in
// the Decide sheet); "Settled n of m" is gone.

import { Btn } from "./ui.tsx";
import type { Here } from "./view.ts";

const day = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function StandLine({
  here,
  q,
}: {
  here: Here;
  // the question whose stand this is: the board you are on, or the root
  q: string;
}) {
  const { view, ws, act } = here;
  const nodes = ws.map.nodes;
  const board = view.boards[q];
  const stand = view.stand[q];
  const point = view.questions.find((p) => p.id === q);
  const title = (id: string | null | undefined) =>
    (id && nodes[id]?.title) || "";
  const decided =
    q === view.root ? view.rollup.state === "decided" : !!point?.settled;
  const commit = board?.commit;
  const causes = (point?.shape ?? board?.shape) === "causes";
  // your own position on a cause list, as a choice is on a board
  const likely = causes
    ? Object.values(nodes).filter(
        (n) =>
          n.parent === q &&
          n.kind === "option" &&
          n.status === "chosen" &&
          !n.dropped,
      )
    : [];
  const chips = view.questions.filter(
    (p) => p.board && p.shape === "choose" && p.id !== q,
  );
  const due = view.outcomeDue.filter((d) => d.q === q);
  // before the first Fill a choice has no lead, and Claude's line only says
  // what would decide it: the board says that better
  const quiet =
    !!board &&
    board.shape === "choose" &&
    board.filledAt === null &&
    board.needsFill &&
    !stand?.lead;
  const sure = (n: number | undefined) =>
    n !== undefined && <span className="text-muted"> (~{n}%)</span>;
  const line = (text: string) => <span data-content> — “{text}”</span>;
  const main = commit ? (
    <span className="text-ink">
      You chose{" "}
      <b className="text-success-strong" data-content>
        {title(commit.option)}
      </b>
      {commit.sure !== undefined && <> ({commit.sure}%)</>}
      {commit.why && <span data-content>: “{commit.why}”</span>}
      {stand?.lead === commit.option ? (
        <span className="text-muted">
          {" "}
          · Claude agrees{stand.sure !== undefined && ` ~${stand.sure}%`}
        </span>
      ) : stand?.lead ? (
        <span className="text-muted">
          {" "}
          · Claude leans{" "}
          <span className="text-primary-strong">
            ★ <span data-content>{title(stand.lead)}</span>
          </span>
          {stand.sure !== undefined && ` ~${stand.sure}%`}
        </span>
      ) : (
        // with no lead Claude agrees with no choice: said here, with its
        // line, whose caveat (what is still unverified) matters
        stand && (
          <span className="text-muted">
            {" "}
            · Claude, no lead
            {line(stand.line)}
          </span>
        )
      )}
    </span>
  ) : point?.answer && point.settled ? (
    <span className="text-ink">
      {point.answer.by === "you" ? "You settled it" : "Claude's answer"}:{" "}
      <span data-content>“{point.answer.text}”</span>
    </span>
  ) : stand && !quiet ? (
    <span className="min-w-0 text-ink">
      {stand.lead ? (
        <>
          {causes ? "Best guess" : "Claude leans"}{" "}
          <b className="text-primary-strong">
            ★ <span data-content>{title(stand.lead)}</span>
          </b>
          {sure(stand.sure)}
        </>
      ) : (
        "Claude"
      )}
      {line(stand.line)}
    </span>
  ) : null;
  const rest =
    likely.length > 0 || chips.length > 0 || due.length > 0 || main || decided;
  if (!rest) return null;

  return (
    <div className="border-b border-line bg-surface px-4 py-2 text-[13px] leading-snug">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {decided && (
          <span className="rounded-md bg-success-soft px-1.5 py-0.5 text-[11px] font-semibold text-success-strong ring-1 ring-success-line">
            ✓ Decided
          </span>
        )}
        {main}
        {stand?.boardSays && !commit && (
          <span
            className="text-xs text-warning-strong"
            title="Worked out from the cells, not from Claude's line"
          >
            · {stand.boardSays}
          </span>
        )}
        {stand?.stale && main && (
          <span
            className="text-xs text-faint"
            title="Written before the last change on the board"
            aria-label="Written before the last change"
          >
            ↻
          </span>
        )}
        {likely.length > 0 && (
          <span className="text-xs text-muted">
            · You marked likely{" "}
            <b className="text-success-strong" data-content>
              {likely.map((n) => n.title).join(", ")}
            </b>
          </span>
        )}
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => here.openBoard(c.id)}
            title={
              c.underAside
                ? `Under a set-aside option: ${c.underAside}`
                : c.settled
                  ? "Settled"
                  : c.gaps > 0
                    ? `Still open: ${c.gaps} empty ${c.gaps === 1 ? "cell" : "cells"}`
                    : "Still open"
            }
            className={`max-w-[240px] truncate rounded-full border px-2 py-0.5 text-xs ${c.settled ? "border-success-line text-success-strong" : c.underAside ? "border-dashed border-line-strong text-faint" : "border-warning-line text-ink"}`}
          >
            <span
              className={c.settled ? "" : c.underAside ? "" : "text-warning"}
            >
              {c.settled ? "✓" : c.underAside ? "◌" : "●"}
            </span>{" "}
            <span data-content>{c.title}</span>
          </button>
        ))}
      </div>

      {due.map((d) => (
        <div
          key={d.q}
          className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-body"
        >
          On {day(d.at)} you chose <span data-content>{d.title}</span>
          {d.sure !== undefined && <>, {d.sure}% sure</>}. How has it gone?
          {(
            [
              ["expected", "As expected"],
              ["worse", "Worse"],
              ["too-soon", "Too soon"],
            ] as const
          ).map(([said, label]) => (
            <Btn
              key={said}
              small
              onClick={() => void act("outcome", { q: d.q, said })}
            >
              {label}
            </Btn>
          ))}
        </div>
      ))}
    </div>
  );
}
