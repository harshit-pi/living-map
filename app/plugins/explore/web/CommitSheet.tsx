// The Decide sheet: the options still in play as one pick, nothing picked
// for you (Claude's lead has its star, nothing more), then why in a line and
// how sure you are, both optional. Opened from Next, or from an option's
// panel with that option picked. What is still open is said here, at the
// moment it matters; choosing anyway stays allowed. Once you choose, Claude
// writes how it could fail, what the choice rests on, and the first steps.

import { useState } from "react";

import { Btn, Pop } from "./ui.tsx";
import type { Anchor, Here } from "./view.ts";

const SURE = [50, 70, 90];

export function CommitSheet({
  here,
  q,
  option,
  at,
  onClose,
}: {
  here: Here;
  q: string;
  // picked already: the sheet was opened from that option's panel
  option: string | null;
  at: Anchor;
  onClose: () => void;
}) {
  const { view } = here;
  const board = view.boards[q];
  const stand = view.stand[q];
  const [pick, setPick] = useState<string | null>(option);
  // the why is yours: Claude's line weighs the options (it may argue for
  // another), so it is never your reason by default
  const [why, setWhy] = useState("");
  // how sure you said you were when you leaned this way
  const [sure, setSure] = useState<number | null>(
    board?.lean && board.lean.option === option
      ? (board.lean.sure ?? null)
      : null,
  );
  if (!board) return null;
  // the options in play; one set aside by a Choose can be picked again from
  // its own panel
  const options = board.columns.filter((c) => !c.faded || c.id === option);
  const open = view.open;
  const commit = () => {
    if (!pick) return;
    void here.act("commit", {
      option: pick,
      why,
      ...(sure !== null ? { sure } : {}),
    });
    onClose();
  };
  const goTo = (id: string) => {
    onClose();
    if (view.boards[id]?.shape === "choose") here.openBoard(id);
    else here.select(id);
  };
  return (
    <Pop anchor={at} width={340} onClose={onClose} title="Decide">
      <div role="radiogroup" aria-label="Your choice" className="space-y-1">
        {options.map((c) => (
          <label
            key={c.id}
            className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] ${pick === c.id ? "bg-panel ring-1 ring-ink" : "hover:bg-panel"}`}
          >
            <input
              type="radio"
              name={`decide-${q}`}
              checked={pick === c.id}
              onChange={() => {
                setPick(c.id);
                // a lean you gave this option keeps its how sure
                if (board.lean?.option === c.id && board.lean.sure)
                  setSure(board.lean.sure);
              }}
              className="mt-0.5"
            />
            <span className="min-w-0 text-ink">
              {c.lead && (
                <span className="text-primary-strong" title="Claude's lead">
                  ★{" "}
                </span>
              )}
              <span data-content>{c.title}</span>
              {c.lean && <span className="text-muted"> · ● your lean</span>}
              {c.failsMust && (
                <span className="text-danger-strong"> · ✕ fails a must</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <input
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        placeholder="Why? (optional)"
        title={
          stand?.lead && stand.lead === pick && stand.line && !board.commit
            ? `Claude: ${stand.line}`
            : "What tipped it, in your words"
        }
        maxLength={200}
        className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[13px] text-ink focus:border-primary focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        How sure?
        {SURE.map((n) => (
          <button
            key={n}
            onClick={() => setSure(sure === n ? null : n)}
            className={`rounded-full border px-2 py-0.5 ${sure === n ? "border-ink bg-panel font-semibold text-ink" : "border-line-strong text-body hover:border-primary"}`}
          >
            {n}%
          </button>
        ))}
      </div>
      {open.length > 0 && (
        <div className="mt-2 text-xs text-warning-strong">
          Still open:{" "}
          <button
            onClick={() => goTo(open[0].q)}
            title="Choosing anyway is allowed"
            className="underline underline-offset-2 hover:text-ink"
          >
            {open[0].label}
          </button>
          {open.length > 1 && ` (+${open.length - 1})`}
        </div>
      )}
      <div className="mt-3">
        <Btn primary lead disabled={!pick} onClick={commit}>
          Choose
        </Btn>
      </div>
    </Pop>
  );
}
