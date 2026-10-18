import { useState, type ReactNode } from "react";

import { SmallBtn, WaitNote } from "./BuildCanvas.tsx";
import { HowSure } from "./CheckCard.tsx";
import { CREDIT, inDays, stepNumber, WAIT_TITLE, type Here } from "./view.ts";
import {
  orderStops,
  placingIsAnswer,
  showsCase,
  type StepView,
  type Sure,
  type WhyState,
} from "../shared.ts";

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
  // what was sent last: the server's refusal ("Say a little more.") is about
  // that text, and goes once you change it
  const [sent, setSent] = useState("");
  const w = st.why;
  if (!w) return null;
  const v = w.state ? VERDICT[w.state] : null;
  const open = st.stage === "why";
  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    setSent(t);
    void act("why", { step: st.step, text: t }).then((r) => {
      if (r.ok) setText("");
    });
  };
  // once the step is built, only the verdict stays: the question was
  // answered (or shown) and the card goes on to what is next
  if (!open)
    return v && !judging ? (
      <div className="text-[12.5px] leading-snug text-body">
        <span className={`font-semibold ${v.cls}`}>
          {v.sym} {v.word}
        </span>{" "}
        <span data-content>{w.say}</span>
      </div>
    ) : null;
  return (
    <div className="space-y-2">
      {w.link && (
        <div className="text-[11.5px] text-muted" data-content>
          “{w.link.from}” {w.link.rel} “{w.link.to}”
        </div>
      )}
      <div
        className="text-[14px] leading-snug font-medium text-ink"
        data-content
      >
        {w.ask}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        rows={3}
        // the one thing to do once the build passed: the cursor is in it
        autoFocus
        placeholder="One or two lines…"
        className="block w-full resize-none rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] outline-hidden focus:border-primary"
      />
      {w.pre && text.trim() === sent && (
        <div className="rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning-strong">
          {w.pre}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        {/* sent as a why, it waits for the map to settle like Send:
            open while Claude worked, a press was dropped */}
        <button
          onClick={() => void act("why", { step: st.step, show: true })}
          disabled={judging || busy}
          title={
            busy ? WAIT_TITLE : "The step counts as built, with the why shown"
          }
          className="text-[11.5px] text-muted hover:text-ink disabled:opacity-40"
        >
          Show the answer
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
      <WaitNote here={here} />
      {judging && (
        <div className="flex items-center gap-2 text-[12px] text-primary-strong">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Claude is reading your why…
        </div>
      )}
      {v && !judging && w.say && (
        <div className="rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px] leading-snug text-body">
          <span className={`font-semibold ${v.cls}`}>
            {v.sym} {v.word}
          </span>{" "}
          <span data-content>{w.say}</span>
          {w.state !== "right" && w.tries > 0 && (
            <div className="mt-1 text-[11.5px] text-muted">Try again.</div>
          )}
        </div>
      )}
    </div>
  );
}

// Once a step is built: what it earned (the learner's honest score), the
// Why's verdict, when it comes back, the one next thing (Next step, or the
// quick rebuild when one waits), and the two optional extras behind "Go
// further".
export function BuiltCard({
  here,
  st,
  whatif,
  onWhatIf,
  onNext,
  writingCase,
  children,
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
    // its result is in: mark the parts on this build
    checked: () => void;
  };
  onWhatIf: () => void;
  onNext: (() => void) | null;
  writingCase: boolean;
  // the Why's verdict, under the done line
  children?: ReactNode;
}) {
  const { act, busy, view } = here;
  const step = st.step;
  const wi = st.whatif;
  const labelOf = (id: string) =>
    st.placed.find((p) => p.id === id)?.label ?? "";
  const caseWriting = writingCase || st.newCase === "writing";
  const n = stepNumber(view, step);
  // the what-if under way owns the filled button; so does a quick rebuild
  // waiting; Next step is outline then (never two filled)
  const nextQuiet = st.recallDue || whatif.on;
  const wiLink = !!wi && !whatif.on && !wi.result;
  const caseLink =
    showsCase(st) &&
    !st.rungs.case &&
    st.newCase !== "ready" &&
    st.newCase !== "broken" &&
    !caseWriting;
  const link =
    "text-primary-strong hover:underline disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-success-soft px-2.5 py-1.5 text-[13px] font-medium text-success-strong">
        ✓ Step {n} done
        {st.rungs.built === "shown"
          ? " · shown"
          : st.rungs.built === "hints"
            ? " · with hints"
            : ""}
      </div>
      {children}
      {/* the spaced return is how Learn works: said here, where it means
          something (the start screen no longer promises it) */}
      {view.due.next !== null && !st.recallDue && (
        <div className="text-[12.5px] text-body">
          Back {inDays(view.due.next, view.now)} for a quick review
        </div>
      )}
      {st.recallDue && (
        <SmallBtn
          primary={!whatif.on}
          // as the rebuild starts: where placing is the answer, the parts
          // wait outside the frame (said "placed", they were in the tray)
          title={
            orderStops(st.frame)
              ? "The parts wait under the axis; you put them in order and draw the key links again"
              : placingIsAnswer(st.frame)
                ? "The parts wait outside the frame; you put each one in place and draw the key links again"
                : "The parts are placed; you draw the key links again"
          }
          onClick={() => void act("recall", { step })}
        >
          Rebuild it (1 min)
        </SmallBtn>
      )}
      {onNext && (
        <SmallBtn primary={!nextQuiet} onClick={onNext}>
          Next step →
        </SmallBtn>
      )}

      {(wiLink || caseLink) && (
        <div className="text-[12px] text-muted">
          Go further:{" "}
          {wiLink && (
            <button
              onClick={onWhatIf}
              title="Change one thing and predict · 30 s"
              className={link}
            >
              What if…
            </button>
          )}
          {wiLink && caseLink && " · "}
          {caseLink && (
            <button
              disabled={busy}
              title={busy ? WAIT_TITLE : "Same idea, new example · 3 min"}
              onClick={() => void act("newCase", { step })}
              className={link}
            >
              New example
            </button>
          )}
        </div>
      )}

      {wi && (whatif.on || wi.result) && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <div className="text-[13px] leading-snug text-ink" data-content>
            {wi.ask}
          </div>
          {wi.result ? (
            <div className="rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px] leading-snug text-body">
              <div className="font-medium">
                {wi.result.found.length} of{" "}
                {wi.result.found.length + wi.result.missed.length} found
                {wi.result.extra.length > 0 &&
                  `, ${wi.result.extra.length} extra`}
              </div>
              {wi.result.missed.length > 0 && (
                <div className="mt-0.5">
                  Missed:{" "}
                  {wi.result.missed.map((id) => `“${labelOf(id)}”`).join(", ")}
                </div>
              )}
              <div className="mt-0.5 text-muted" data-content>
                {wi.result.why}
              </div>
            </div>
          ) : (
            <>
              <div className="text-[12px] text-muted">
                {/* the question asks what is affected, and the answer can
                    be a part that works harder, not one that stops */}
                Click every part this affects ({whatif.picked.length} picked).
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
                      if (r.error) return;
                      whatif.stop();
                      whatif.checked();
                    });
                  }}
                >
                  Check
                </SmallBtn>
                <SmallBtn onClick={whatif.stop}>Cancel</SmallBtn>
              </div>
            </>
          )}
        </div>
      )}

      {/* a play step's order and a parts step's cast are the same on any
          case (offersCase) */}
      {showsCase(st) && !caseLink && (
        <div className="text-[12px] text-muted">
          {st.rungs.case ? (
            <span className="text-success-strong">
              {/* its credit, as the done line says its own: a case built
                  after Show the model read as if it were yours */}
              ✓ New example built · {CREDIT[st.rungs.case].word}
            </span>
          ) : caseWriting ? (
            <span className="animate-pulse">
              Claude is writing a new example…
            </span>
          ) : st.newCase === "ready" ? (
            <>
              Your new example is ready.{" "}
              <button
                onClick={() => void act("onCase", { step, on: true })}
                className={link}
              >
                Open it
              </button>
            </>
          ) : (
            <>
              The new example did not hold together.{" "}
              <button
                disabled={busy}
                title={busy ? WAIT_TITLE : "One Claude move"}
                onClick={() => void act("newCase", { step })}
                className={link}
              >
                Try again
              </button>
            </>
          )}
        </div>
      )}
      {/* while the new example is written, the line above says so; its
          Try again waits for the map to settle, and this says why */}
      {st.newCase === "broken" && !caseWriting ? (
        <WaitNote here={here} typed={false} />
      ) : null}
    </div>
  );
}
