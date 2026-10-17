// "Where it stands", pinned above the board or the tree on every move: the
// state (worked out on the server, never taken from Claude), Claude's lead
// with its line and how sure it is, your lean and your choice, how many
// decision points are settled, what is still open, and the sub-choices to
// open. When Claude's line is older than the last change, it says so.

import { useState } from "react";

import { Btn, Pop } from "./ui.tsx";
import { anchorOf, type Anchor, type Here } from "./view.ts";
import type { RootState } from "../shared.ts";

const STATE_LOOK: Record<RootState, { word: string; cls: string }> = {
  decided: {
    word: "Decided",
    cls: "bg-success-soft text-success-strong ring-success-line",
  },
  leaning: {
    word: "Leaning",
    cls: "bg-primary-soft text-primary-strong ring-primary-line",
  },
  open: {
    word: "Open",
    cls: "bg-warning-soft text-warning-strong ring-warning-line",
  },
};
const SURE = [50, 70, 90];
const day = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function StandLine({
  here,
  q,
  onBoard,
}: {
  here: Here;
  // the question whose stand this is: the board you are on, or the root
  q: string;
  onBoard: boolean;
}) {
  const { view, ws, act } = here;
  const nodes = ws.map.nodes;
  const [loose, setLoose] = useState<Anchor | null>(null);
  const board = view.boards[q];
  const stand = view.stand[q];
  const point = view.questions.find((p) => p.id === q);
  const title = (id: string | null | undefined) =>
    (id && nodes[id]?.title) || "";
  const leadCol = board?.columns.find((c) => c.lead);
  // the root's state is the whole map's; a sub-board's is its own
  const state: RootState =
    q === view.root
      ? view.rollup.state
      : point?.settled
        ? "decided"
        : leadCol || board?.columns.some((c) => c.chosen)
          ? "leaning"
          : "open";
  const look = STATE_LOOK[state];
  const commit = board?.commit;
  const causes = (point?.shape ?? board?.shape) === "causes";
  const lean = board?.lean;
  // your own position on a cause list, as a lean is on a choice
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
  // this choice's own: the facts of a diagnosis above it back no cell here
  const looseFacts = board?.looseFacts ?? [];
  // an open item opens its board, or, for a question that is not a choice,
  // its node on the tree
  const goTo = (id: string) => {
    if (view.boards[id]?.shape === "choose") here.openBoard(id);
    else here.select(id);
  };

  return (
    <div className="border-b border-line bg-surface px-4 py-2 text-[13px] leading-snug">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ring-1 ${look.cls}`}
        >
          {look.word}
        </span>
        {commit ? (
          <span className="text-ink">
            You chose{" "}
            <b className="text-success-strong">✓ {title(commit.option)}</b>
            {commit.sure !== undefined && <> ({commit.sure}%)</>}
            {commit.why && <>: “{commit.why}”</>}
            {stand?.lead === commit.option ? (
              <span className="text-muted">
                {" "}
                · Claude agrees{stand.sure !== undefined && ` ~${stand.sure}%`}
              </span>
            ) : stand?.lead ? (
              <span className="text-muted">
                {" "}
                · Claude leads{" "}
                <span className="text-primary-strong">
                  ★ {title(stand.lead)}
                </span>
                {stand.sure !== undefined && ` ~${stand.sure}%`}
              </span>
            ) : (
              // with no lead Claude agrees with no choice: said here, not
              // only in a caption that is gone in seconds, and with its
              // line, whose caveat (what is still unverified) was only in a
              // hover title, so the board read as if Claude had no view
              stand && (
                <span className="text-muted">
                  {" "}
                  ·{" "}
                  {/^\s*no lead/i.test(stand.line)
                    ? "Claude"
                    : "Claude, no lead"}
                  : “{stand.line}”
                </span>
              )
            )}
          </span>
        ) : point?.answer && point.settled ? (
          <span className="text-ink">
            {point.answer.by === "you" ? "You settled it" : "Claude's answer"}:
            “{point.answer.text}”
          </span>
        ) : stand ? (
          <span className="min-w-0 text-ink">
            {stand.lead ? (
              <>
                {causes ? "Claude's best guess" : "Claude leads"}{" "}
                <b className="text-primary-strong">★ {title(stand.lead)}</b>
                :{" "}
              </>
            ) : (
              "Claude: "
            )}
            “{stand.line}”
            {/* how sure is about a lead: with none, a figure says nothing */}
            {stand.lead && stand.sure !== undefined && (
              <span className="text-muted"> · ~{stand.sure}% sure</span>
            )}
          </span>
        ) : (
          <span className="text-muted">
            Claude has not said where it stands yet.
          </span>
        )}
        {stand?.boardSays && !commit && (
          <span
            className="text-xs text-warning-strong"
            title="Worked out from the cells, not from Claude's line"
          >
            · {stand.boardSays}
          </span>
        )}
        {stand?.stale && (
          <span
            className="text-xs text-faint"
            title="Something on the board changed after Claude wrote this line"
          >
            · written before the last change
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {likely.length > 0 && (
          <span>
            You marked likely{" "}
            <b className="text-success-strong">
              ✓ {likely.map((n) => n.title).join(", ")}
            </b>
          </span>
        )}
        {lean && !commit && (
          <span className="flex items-center gap-1">
            You lean <b className="text-ink">● {title(lean.option)}</b>
            {SURE.map((n) => (
              <button
                key={n}
                onClick={() =>
                  void act("lean", {
                    q,
                    option: lean.option,
                    ...(lean.sure === n ? {} : { sure: n }),
                  })
                }
                title="How sure you are (kept from Claude)"
                className={`rounded-full border px-1.5 ${lean.sure === n ? "border-ink text-ink" : "border-line text-muted hover:border-primary"}`}
              >
                {n}%
              </button>
            ))}
          </span>
        )}
        <span>
          Settled{" "}
          <b className="text-ink">
            {view.rollup.settled} of {view.rollup.total}
          </b>
        </span>
        {view.open.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-1">
            Open:
            {view.open.map((o, i) => (
              <span key={o.kind}>
                <button
                  onClick={() => goTo(o.q)}
                  className="text-warning-strong underline-offset-2 hover:underline"
                >
                  {o.label}
                </button>
                {i < view.open.length - 1 && " ·"}
              </span>
            ))}
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
                  : "Still open"
            }
            className={`max-w-[240px] truncate rounded-full border px-2 py-0.5 ${c.settled ? "border-success-line text-success-strong" : c.underAside ? "border-dashed border-line-strong text-faint" : "border-warning-line text-ink"}`}
          >
            <span
              className={c.settled ? "" : c.underAside ? "" : "text-warning"}
            >
              {c.settled ? "✓" : c.underAside ? "◌" : "●"}
            </span>{" "}
            {c.title}
            {!c.settled && c.gaps > 0 && (
              <span className="text-muted">
                : {c.gaps} {c.gaps === 1 ? "gap" : "gaps"}
              </span>
            )}
          </button>
        ))}
        {onBoard && looseFacts.length > 0 && (
          <button
            onClick={(e) => setLoose(anchorOf(e.currentTarget))}
            title="Facts on this choice that back no cell"
            className="rounded-full border border-line px-2 py-0.5 hover:border-primary hover:text-ink"
          >
            Loose facts {looseFacts.length}
          </button>
        )}
      </div>

      {due.map((d) => (
        <div
          key={d.q}
          className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-body"
        >
          On {day(d.at)} you chose {d.title}
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

      {loose && (
        <Pop
          anchor={loose}
          width={300}
          title="Loose facts: they back no cell yet"
          onClose={() => setLoose(null)}
        >
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {looseFacts.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => {
                    here.select(f.id);
                    setLoose(null);
                  }}
                  className="text-left text-[12.5px] text-body hover:text-primary-strong"
                >
                  {f.title}
                </button>
              </li>
            ))}
          </ul>
        </Pop>
      )}
    </div>
  );
}
