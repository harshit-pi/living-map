import { useState } from "react";

import { SmallBtn } from "./BuildCanvas.tsx";
import { HowSure } from "./CheckCard.tsx";
import { CREDIT, helpLine, type Here } from "./view.ts";
import {
  showsCase,
  type Credit,
  type Level,
  type StepView,
  type Sure,
} from "../shared.ts";

const LEVELS: [Level, string, string][] = [
  ["new", "I'm new", "see a worked case first"],
  ["some", "I know some", "start building, parts placed"],
  ["cold", "Test me cold", "the frame and the parts, no links"],
];

// Once per map, above step 1: how much help the first builds start with.
// It can be changed later; steps you have started keep what you did.
export function LevelChooser({
  here,
  level,
}: {
  here: Here;
  level: Level | null;
}) {
  const [open, setOpen] = useState(false);
  if (level && !open)
    return (
      <div className="flex items-center justify-end gap-2 text-[11.5px] text-muted">
        Starting help: {LEVELS.find((l) => l[0] === level)?.[1]}
        <button
          onClick={() => setOpen(true)}
          className="text-primary-strong hover:underline"
        >
          change
        </button>
      </div>
    );
  return (
    <div className="rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[14px] font-medium text-ink">
          How much do you know already?
        </span>
        {LEVELS.map(([lv, label, says]) => (
          <button
            key={lv}
            title={says}
            onClick={() => {
              setOpen(false);
              void here.act("level", { level: lv });
            }}
            className={`rounded-full border px-3 py-1 text-[13px] ${level === lv ? "border-primary bg-primary-soft text-primary-strong" : "border-line-strong bg-surface text-body hover:border-primary"}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[11.5px] text-faint">
          you can change it later
        </span>
      </div>
    </div>
  );
}

type Dot = "done" | "now" | "todo" | "skip";
const DOT: Record<Dot, string> = {
  done: "✓",
  now: "●",
  todo: "○",
  skip: "–",
};

const creditDot = (c: Credit | null, now: boolean): [Dot, string] =>
  now ? ["now", ""] : c ? ["done", CREDIT[c].word] : ["todo", ""];

// See ─ Build ─ Why ┊ What if ┊ New case: where you are on the step, and
// what each finished rung earned (by you, with hints, shown).
export function StageStrip({
  st,
  skippedSee,
}: {
  st: StepView;
  // the level chooser started this step past See (I know some, Test me cold)
  skippedSee: boolean;
}) {
  const seen: Dot =
    st.stage === "see"
      ? "now"
      : skippedSee && !st.rungs.built
        ? "skip"
        : "done";
  const all: [string, Dot, string][] = [
    ["See it", st.onCase || st.recall || st.reviewing ? "skip" : seen, ""],
    ["Build", ...creditDot(st.rungs.built, st.stage === "build" && !st.onCase)],
    ["Why", ...creditDot(st.rungs.why, st.stage === "why")],
    ["What if", ...creditDot(st.rungs.whatif, false)],
    ["New case", ...creditDot(st.rungs.case, st.onCase)],
  ];
  // a step that offers no new case has no rung for one (showsCase)
  const items = all.filter(([label]) => label !== "New case" || showsCase(st));
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px]">
      {items.map(([label, dot, word], i) => (
        <span key={label} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-faint">{i >= 3 ? "┊" : "─"}</span>}
          <span
            title={word || undefined}
            className={
              dot === "now"
                ? "font-semibold text-primary-strong"
                : dot === "done"
                  ? "text-success-strong"
                  : "text-muted"
            }
          >
            {label} {DOT[dot]}
          </span>
        </span>
      ))}
      {st.stage === "build" && (
        <span className="ml-2 text-[12px] text-muted">· {helpLine(st)}</span>
      )}
      {st.stage === "build" && st.lowered && (
        <span className="text-[12px] text-warning-strong">
          · more help this time: your quick rebuild needed a second check
        </span>
      )}
    </div>
  );
}

// Before you look away: one question with a pick and how sure you are. A
// wrong pick shows its misconception at once; nothing here calls Claude.
export function PredictCard({ here, st }: { here: Here; st: StepView }) {
  const [pick, setPick] = useState<string | null>(null);
  const [sure, setSure] = useState<Sure | null>(null);
  const p = st.predict;
  const hide = (
    <div className="flex justify-end">
      <SmallBtn
        primary
        onClick={() => void here.act("hide", { step: st.step })}
      >
        {st.predict ? "Hide it, I'll build it →" : "Hide it and build it →"}
      </SmallBtn>
    </div>
  );
  if (!p) return hide;
  const done = p.picked !== null;
  const send = (choice: string | null, s: Sure | null) => {
    if (choice && s)
      void here.act("predict", { step: st.step, pick: choice, sure: s });
  };
  return (
    <div className="space-y-2">
      <div className="text-[14px] font-medium text-ink">
        Before you look: {p.ask}
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
              onClick={() => {
                setPick(c);
                send(c, sure);
              }}
              className={`rounded-lg border px-3 py-1 text-[13px] ${cls}`}
            >
              {c}
              {done && mine && (p.right ? " ✓" : " ✗")}
            </button>
          );
        })}
      </div>
      {!done && (
        <HowSure
          value={sure}
          onPick={(s) => {
            setSure(s);
            send(pick, s);
          }}
        />
      )}
      {done && (
        <div className="text-[12.5px] leading-snug text-body">
          {p.right ? (
            <span className="text-success-strong">
              Right. Look at where it sits in the case before you hide it.
            </span>
          ) : (
            <>
              <span className="font-medium text-danger-strong">Not that.</span>{" "}
              {p.correct && (
                <>
                  It is “<span className="font-medium">{p.correct}</span>”.{" "}
                </>
              )}
              {p.refute ??
                "Look at where it sits in the case before you hide it."}
            </>
          )}
        </div>
      )}
      {done ? (
        hide
      ) : (
        <div className="text-[11.5px] text-faint">
          Pick one and say how sure you are; then the case shows in full.
        </div>
      )}
    </div>
  );
}
