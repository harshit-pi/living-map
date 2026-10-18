import { SmallBtn } from "./BuildCanvas.tsx";
import { inDays, stepNumber, type Here } from "./view.ts";
import { reviewMinutes } from "../../../web/lib/ago.ts";
import type { LearnView, ReviewView } from "../shared.ts";

// The map opens here when something is due: how much, and one press to
// start. Not now goes on along the path; what is due stays due.
export function ReviewStart({
  here,
  onPath,
}: {
  here: Here;
  onPath: () => void;
}) {
  const { view } = here;
  const steps = view.steps.filter((s) => s.itemsDue > 0);
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-xs ring-1 ring-line">
        <div className="text-[18px] font-semibold text-ink">Time to review</div>
        <div className="mt-1 text-[13px] text-muted">
          {steps.length} {steps.length === 1 ? "step" : "steps"} · about{" "}
          {reviewMinutes(steps.length)} min
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SmallBtn primary onClick={() => void here.act("review")}>
            Start the review
          </SmallBtn>
          <button
            onClick={onPath}
            className="text-[12.5px] text-muted hover:text-ink"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

// Over the canvas while a review of more than one step is open: the due
// steps in the order they come ("Review 1 of 2" is said on the canvas).
export function ReviewStrip({
  view,
  review,
  current,
  onPick,
}: {
  view: LearnView;
  review: ReviewView;
  current: string | null;
  onPick: (step: string) => void;
}) {
  if (review.order.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
      {review.order.map((id) => {
        const st = view.steps.find((s) => s.step === id);
        if (!st) return null;
        return (
          <button
            key={id}
            onClick={() => onPick(id)}
            className={`rounded-full px-2 py-0.5 ${current === id ? "bg-primary-soft text-primary-strong ring-1 ring-primary-line" : "text-body hover:bg-panel"}`}
          >
            {st.reviewing ? "" : "✓ "}
            {stepNumber(view, id)} <span data-content>{st.title}</span>
          </button>
        );
      })}
    </div>
  );
}

// Beside a review, under the rebuild's own check card: how the last rebuild
// came out, the step still to rebuild when you are on another, and I'm done
// today. Once the rebuilds are done, "Which idea is this?" one card at a
// time; with none left the screen closes the review (ClosingCard).
export function ReviewPanel({
  here,
  review,
  current,
  onPick,
  onDone,
}: {
  here: Here;
  review: ReviewView;
  current?: string;
  onPick?: (step: string) => void;
  // I'm done today: the screen closes the review and keeps what it said
  onDone: () => void;
}) {
  const { view, act } = here;
  const due = review.order.filter(
    (id) => view.steps.find((s) => s.step === id)?.reviewing,
  );
  const left = due.length;
  const next = onPick && !due.includes(current ?? "") ? due[0] : undefined;
  // the rebuild just checked, told as it comes out: the review goes on to
  // the next step at once, and its result was otherwise never seen
  const doneSteps = review.order.filter((id) => !due.includes(id));
  const lastStep = doneSteps[doneSteps.length - 1];
  const lastItems = review.items.filter((it) => it.step === lastStep);
  const card = review.cards.find((c) => c.picked === null);
  const answered = review.cards.filter((c) => c.picked !== null);
  const lastCard = answered[answered.length - 1];
  const titleOf = (id: string | null) =>
    view.steps.find((s) => s.step === id)?.title ?? "";

  if (left > 0)
    return (
      <div className="space-y-2">
        {lastStep && lastItems.length > 0 && (
          <div className="text-[12.5px] text-success-strong">
            ✓ Step {stepNumber(view, lastStep)} rebuilt ·{" "}
            {lastItems.filter((it) => it.today === "unaided").length} of{" "}
            {lastItems.length} by you
          </div>
        )}
        {next && onPick && (
          <SmallBtn primary onClick={() => onPick(next)}>
            Rebuild the next step →
          </SmallBtn>
        )}
        <button
          onClick={onDone}
          title="What you did not rebuild stays due"
          className="text-[12px] text-muted hover:text-ink"
        >
          I'm done today
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      {lastCard && (
        <div
          className={`text-[12.5px] ${lastCard.right ? "text-success-strong" : "text-danger-strong"}`}
        >
          {lastCard.right ? (
            "✓ Right."
          ) : (
            <>
              ✗ It was “<span data-content>{titleOf(lastCard.correct)}</span>
              ”.
            </>
          )}
        </div>
      )}
      {card ? (
        <div className="space-y-1.5">
          <div className="text-[13px] font-medium text-ink">
            Which idea is this?
          </div>
          <div className="text-[12.5px] leading-snug text-ink" data-content>
            {card.ask}
          </div>
          <div className="flex flex-col gap-1">
            {card.choices.map((ch) => (
              <button
                key={ch.step}
                onClick={() =>
                  void act("idea", { card: card.id, pick: ch.step })
                }
                className="rounded-lg border border-line-strong px-2 py-1 text-left text-[12.5px] text-body hover:border-primary"
              >
                <span data-content>{ch.title}</span>
              </button>
            ))}
          </div>
          <button
            onClick={onDone}
            className="text-[12px] text-muted hover:text-ink"
          >
            I'm done today
          </button>
        </div>
      ) : null}
    </div>
  );
}

// What a finished review leaves on screen once it is closed (the server
// logs it then, so "next review" is the real day): today's score beside
// last time's, and the next step on the path if one is left. Nothing here
// is filled: the visit is over.
export function ClosingCard({
  view,
  closed,
  onCarryOn,
}: {
  view: LearnView;
  closed: {
    unaided: number;
    of: number;
    last: number | null;
    // the last "which idea" card, told as it came out: the review closed
    // the moment it was answered
    card: { right: boolean; correct: string | null } | null;
  };
  onCarryOn: { step: string; go: () => void } | null;
}) {
  const card = closed.card;
  return (
    <div className="space-y-2">
      {card && (
        <div
          className={`text-[12.5px] ${card.right ? "text-success-strong" : "text-danger-strong"}`}
        >
          {card.right ? (
            "✓ Right."
          ) : (
            <>
              ✗ It was “
              <span data-content>
                {view.steps.find((s) => s.step === card.correct)?.title ?? ""}
              </span>
              ”.
            </>
          )}
        </div>
      )}
      <div className="rounded-lg bg-success-soft px-2.5 py-1.5 text-[13px] leading-snug font-medium text-success-strong">
        ✓ Done for today · {closed.unaided} of {closed.of} by you
        {closed.last !== null ? ` (last time ${closed.last})` : ""}.
        {view.due.next !== null &&
          ` Next review ${inDays(view.due.next, view.now)}.`}
      </div>
      {onCarryOn && (
        <SmallBtn onClick={onCarryOn.go}>
          Carry on: step {stepNumber(view, onCarryOn.step)}
        </SmallBtn>
      )}
    </div>
  );
}
