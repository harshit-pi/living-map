import { useState } from "react";

import { SmallBtn } from "./BuildCanvas.tsx";
import { HowSure } from "./CheckCard.tsx";
import { WAIT_TITLE, type Here } from "./view.ts";
import type { StepView, Sure, WhyState } from "../shared.ts";

const VERDICT: Record<WhyState, { sym: string; word: string; cls: string }> = {
  right: { sym: "✓", word: "Right.", cls: "text-success-strong" },
  partial: { sym: "◐", word: "Partly.", cls: "text-warning-strong" },
  wrong: { sym: "✗", word: "Not yet.", cls: "text-danger-strong" },
  shown: { sym: "◉", word: "Shown.", cls: "text-hint-strong" },
};

// One question on a key link once the build passes. The server refuses a
// why that is too short or only says the labels back, with no model call;
// Claude judges the rest against its rubric and, if it is not there yet,
// asks one question back, never the fix.
export function WhyCard({
  here,
  st,
  judging,
}: {
  here: Here;
  st: StepView;
  // Claude is reading this step's why now
  judging: boolean;
}) {
  const { act, busy } = here;
  const [text, setText] = useState("");
  const w = st.why;
  if (!w) return null;
  const v = w.state ? VERDICT[w.state] : null;
  const open = st.stage === "why";
  const send = () => {
    const t = text.trim();
    if (!t) return;
    void act("why", { step: st.step, text: t }).then((r) => {
      if (r.ok) setText("");
    });
  };
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
        Why · 1 question
      </div>
      {w.link && (
        <div className="text-[11.5px] text-muted">
          On “{w.link.from}” {w.link.rel} “{w.link.to}”
        </div>
      )}
      <div className="text-[14px] leading-snug font-medium text-ink">
        {w.ask}
      </div>
      {open && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            rows={3}
            placeholder="One or two lines, in your own words…"
            className="block w-full resize-none rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] outline-hidden focus:border-primary"
          />
          {w.pre && (
            <div className="rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning-strong">
              {w.pre}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => void act("why", { step: st.step, show: true })}
              disabled={judging}
              title="The step counts as built, with the why shown"
              className="text-[11.5px] text-muted hover:text-ink disabled:opacity-40"
            >
              Skip: show me
            </button>
            <SmallBtn
              primary
              disabled={busy || !text.trim()}
              title={busy ? WAIT_TITLE : "One Claude move, a few seconds"}
              onClick={send}
            >
              Send
            </SmallBtn>
          </div>
        </>
      )}
      {judging && (
        <div className="flex items-center gap-2 text-[12px] text-primary-strong">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Claude is reading your why…
        </div>
      )}
      {v && !judging && (w.say || !open) && (
        <div className="rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px] leading-snug text-body">
          <span className={`font-semibold ${v.cls}`}>
            {v.sym} {v.word}
          </span>{" "}
          {w.say}
          {open && w.state !== "right" && w.tries > 0 && (
            <div className="mt-1 text-[11.5px] text-muted">
              Answer the question above, then send again.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Once a step is built: what it earned, and the two optional extras (What
// if and New case), a quick rebuild when one waits, and the next step.
export function BuiltCard({
  here,
  st,
  whatif,
  onWhatIf,
  onNext,
  writingCase,
}: {
  here: Here;
  st: StepView;
  // the what-if click mode: on, the parts clicked, and how sure
  whatif: {
    on: boolean;
    picked: string[];
    sure: Sure | null;
    setSure: (s: Sure) => void;
    stop: () => void;
  };
  onWhatIf: () => void;
  onNext: (() => void) | null;
  writingCase: boolean;
}) {
  const { act, busy } = here;
  const step = st.step;
  const wi = st.whatif;
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-success-soft px-2.5 py-1.5 text-[13px] font-medium text-success-strong">
        ✓ Built
        {st.rungs.built === "shown"
          ? " · shown"
          : st.rungs.built === "hints"
            ? " · with hints"
            : " · by you"}
      </div>

      {st.recallDue && (
        <div className="rounded-lg border border-primary-line bg-primary-soft/60 px-2.5 py-2">
          <div className="text-[12.5px] font-medium text-primary-strong">
            ↻ Quick rebuild
          </div>
          <div className="mt-0.5 text-[12px] text-body">
            About a minute: the parts are placed, you draw the key links again.
          </div>
          <div className="mt-1.5">
            <SmallBtn primary onClick={() => void act("recall", { step })}>
              Rebuild it now
            </SmallBtn>
          </div>
        </div>
      )}

      {wi && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
            What if · optional
          </div>
          <div className="text-[13px] leading-snug text-ink">{wi.ask}</div>
          {wi.result ? (
            <div className="rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px] leading-snug text-body">
              <div className="font-medium">
                {wi.result.found.length} of{" "}
                {wi.result.found.length + wi.result.missed} found
                {wi.result.extra.length > 0 &&
                  `, ${wi.result.extra.length} extra`}
              </div>
              <div className="mt-0.5 text-muted">{wi.result.why}</div>
            </div>
          ) : whatif.on ? (
            <>
              <div className="text-[12px] text-muted">
                Click every part on your build that stops working (
                {whatif.picked.length} picked).
              </div>
              <HowSure value={whatif.sure} onPick={whatif.setSure} />
              <div className="flex gap-1.5">
                <SmallBtn
                  primary
                  disabled={!whatif.picked.length}
                  onClick={() => {
                    void act("whatif", {
                      step,
                      parts: whatif.picked,
                      ...(whatif.sure ? { sure: whatif.sure } : {}),
                    }).then((r) => {
                      if (!r.error) whatif.stop();
                    });
                  }}
                >
                  Check
                </SmallBtn>
                <SmallBtn onClick={whatif.stop}>Cancel</SmallBtn>
              </div>
            </>
          ) : (
            <SmallBtn onClick={onWhatIf}>What if (30 s)</SmallBtn>
          )}
        </div>
      )}

      <div className="space-y-1.5 border-t border-line pt-2">
        <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
          New case · optional
        </div>
        {st.rungs.case ? (
          <div className="text-[12.5px] text-success-strong">
            ✓ New case built
          </div>
        ) : writingCase || st.newCase === "writing" ? (
          <div className="flex items-center gap-2 text-[12px] text-primary-strong">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            Claude is writing a new case…
          </div>
        ) : (
          <>
            <div className="text-[12px] text-muted">
              The same idea on a case that looks different, built at L2.
              {st.newCase === "broken" &&
                " The last one did not hold together."}
            </div>
            <SmallBtn
              disabled={busy}
              title={busy ? WAIT_TITLE : "One Claude move"}
              onClick={() => void act("newCase", { step })}
            >
              {st.newCase === "broken" ? "Try again" : "New case (about 3 min)"}
            </SmallBtn>
          </>
        )}
      </div>

      {onNext && (
        <div className="border-t border-line pt-2">
          <SmallBtn primary onClick={onNext}>
            Next step →
          </SmallBtn>
        </div>
      )}
    </div>
  );
}
