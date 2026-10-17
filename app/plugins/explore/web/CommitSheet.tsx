// The Choose… sheet: why, in one line, and how sure you are. Both are
// optional; once you choose, Claude writes how it could fail, what the choice
// rests on, and the first steps.

import { useState } from "react";

import { Btn, Pop } from "./ui.tsx";
import type { Anchor, Here } from "./view.ts";

const SURE = [50, 70, 90];

export function CommitSheet({
  here,
  option,
  at,
  onClose,
}: {
  here: Here;
  option: string;
  at: Anchor;
  onClose: () => void;
}) {
  const node = here.ws.map.nodes[option];
  const q = node?.parent ?? "";
  const stand = here.view.stand[q];
  const lean = here.view.boards[q]?.lean;
  // the why is yours: Claude's line weighs the options (it may argue for
  // another), so it is a hint to start from, never your reason by default
  const [why, setWhy] = useState("");
  // once a choice is made, Claude's line is about that choice, whatever it
  // leads: it argues for this option only when nothing is chosen yet
  const hint =
    stand?.lead === option && stand.line && !here.view.boards[q]?.commit
      ? `Claude: ${stand.line}`
      : "What tipped it, in your words";
  // how sure you said you were when you leaned this way
  const [sure, setSure] = useState<number | null>(
    lean?.option === option ? (lean.sure ?? null) : null,
  );
  if (!node) return null;
  const commit = (args: Record<string, unknown>) => {
    void here.act("commit", { option, ...args });
    onClose();
  };
  return (
    <Pop
      anchor={at}
      width={340}
      onClose={onClose}
      title={<>Choose “{node.title}”</>}
    >
      <label className="block text-xs text-muted">
        Why, in one line (optional)
        <input
          autoFocus
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter")
              commit({ why, ...(sure !== null ? { sure } : {}) });
          }}
          placeholder={hint}
          title={hint}
          maxLength={200}
          className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[13px] text-ink focus:border-primary focus:outline-none"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        How sure are you? (optional)
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn
          primary
          onClick={() => commit({ why, ...(sure !== null ? { sure } : {}) })}
        >
          Choose
        </Btn>
        <button
          onClick={() => commit({})}
          className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Choose without these
        </button>
      </div>
      <div className="mt-2 text-[11.5px] leading-snug text-faint">
        Claude then writes how it could fail, the assumptions it rests on, and
        the first steps.
      </div>
    </Pop>
  );
}
