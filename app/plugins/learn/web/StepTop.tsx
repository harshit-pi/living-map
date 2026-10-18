import { useState } from "react";

import { HowSure } from "./CheckCard.tsx";
import { LEVELS, type Here } from "./view.ts";
import type { Action } from "../../../shared/model.ts";
import { PLUGIN_ID, type Level, type StepView, type Sure } from "../shared.ts";

const QUESTION = "How much do you know?";

// The three levels as one column of buttons. Nothing picked, "I'm new" is
// the filled one (the safe start); once one is picked it is marked, and
// nothing is filled: there is nothing left to do here.
function LevelButtons({
  level,
  onPick,
}: {
  level: Level | null;
  onPick: (lv: Level) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {LEVELS.map(([lv, label, says]) => {
        const primary = !level && lv === "new";
        const mine = level === lv;
        return (
          <button
            key={lv}
            title={says}
            data-primary={primary || undefined}
            onClick={() => onPick(lv)}
            className={`rounded-lg px-3 py-1.5 text-left text-[13px] font-medium ${primary ? "bg-primary text-on-primary hover:bg-primary-strong" : mine ? "bg-primary-soft text-primary-strong ring-1 ring-primary" : "border border-line-strong bg-surface text-body hover:border-primary"}`}
          >
            {mine ? `✓ ${label}` : label}
          </button>
        );
      })}
    </div>
  );
}

// Top of the right card on a map with no level yet, while step 1 is drawn
// and after: the first thing to do on the map, and it calls no model.
export function LevelCard({
  here,
  level,
}: {
  here: Here;
  level: Level | null;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[14px] font-medium text-ink">{QUESTION}</div>
      <LevelButtons
        level={level}
        onPick={(lv) => void here.act("level", { level: lv })}
      />
    </div>
  );
}

// The same question on the loading screen, the moment you press Start: the
// answer is held and sent as the free level move once the map exists, so
// the first thing you do never waits on Claude drawing step 1.
export function LevelWaiting({
  held,
  hold,
}: {
  held: Action | null;
  hold: (a: Action) => void;
}) {
  const level =
    held?.type === "plugin" ? ((held.args?.level as Level) ?? null) : null;
  return (
    <div className="mx-auto w-64 space-y-2 text-left">
      <div className="text-center text-[15px] font-medium text-ink">
        {QUESTION}
      </div>
      <LevelButtons
        level={level}
        onPick={(lv) =>
          hold({
            type: "plugin",
            plugin: PLUGIN_ID,
            name: "level",
            args: { level: lv },
          })
        }
      />
    </div>
  );
}

// Before you look away: one question, then how sure you are. A wrong pick
// shows its misconception at once; nothing here calls Claude. The sure row
// comes after the pick, and the pick is graded once both are in: shown
// together, the row went the moment a choice was clicked.
export function PredictCard({ here, st }: { here: Here; st: StepView }) {
  const [pick, setPick] = useState<string | null>(null);
  const [sure, setSure] = useState<Sure | null>(null);
  const p = st.predict;
  const hide = (
    <div className="flex justify-end">
      <button
        data-primary
        onClick={() => void here.act("hide", { step: st.step })}
        className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-on-primary hover:bg-primary-strong"
      >
        {/* one wording, with a question or without (after Show the model) */}
        Hide it, I'll build it →
      </button>
    </div>
  );
  // with no question, the example is the whole card: look, then hide it
  if (!p) return st.worked ? hide : null;
  const done = p.picked !== null;
  const send = (s: Sure) => {
    setSure(s);
    if (pick) void here.act("predict", { step: st.step, pick, sure: s });
  };
  return (
    <div className="space-y-2">
      <div className="text-[14px] font-medium text-ink">
        Before you look: <span data-content>{p.ask}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {p.choices.map((c) => {
          const mine = (done ? p.picked : pick) === c;
          const cls = done
            ? mine
              ? p.right
                ? "border-success bg-success-soft text-success-strong"
                : "border-danger bg-danger-soft text-danger-strong"
              : "border-line text-muted"
            : mine
              ? "border-primary bg-primary-soft text-primary-strong"
              : "border-line-strong bg-surface text-body hover:border-primary";
          return (
            <button
              key={c}
              disabled={done}
              onClick={() => setPick(c)}
              className={`rounded-lg border px-3 py-1 text-[13px] ${cls}`}
            >
              <span data-content>{c}</span>
              {done && mine && (p.right ? " ✓" : " ✗")}
            </button>
          );
        })}
      </div>
      {!done && pick && <HowSure value={sure} onPick={send} />}
      {done && (
        <div className="text-[12.5px] leading-snug text-body">
          {p.right ? (
            <span className="text-success-strong">
              ✓ Right. See where it sits, then hide it.
            </span>
          ) : (
            <>
              <span className="font-medium text-danger-strong">
                ✗ Not that.
              </span>{" "}
              {p.correct && (
                <>
                  It is “<span className="font-medium">{p.correct}</span>”.{" "}
                </>
              )}
              {p.refute ?? "See where it sits, then hide it."}
            </>
          )}
        </div>
      )}
      {done && hide}
    </div>
  );
}
