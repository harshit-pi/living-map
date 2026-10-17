import { SmallBtn } from "./BuildCanvas.tsx";
import { minutesFor, stepNumber, type Here } from "./view.ts";
import type { How, LearnView, ReviewView } from "../shared.ts";

const HOW: Record<How, string> = {
  unaided: "by you",
  hinted: "hinted",
  shown: "shown",
  wrong: "wrong",
};
const howCls = (h: How | null) =>
  h === "unaided"
    ? "text-success-strong"
    : h === "hinted"
      ? "text-warning-strong"
      : h === "shown"
        ? "text-hint-strong"
        : h === "wrong"
          ? "text-danger-strong"
          : "text-faint";

// The map opens here when something is due: how much, and one press to
// start. Nothing here blocks the rest of the map.
export function ReviewStart({
  here,
  onPath,
}: {
  here: Here;
  onPath: () => void;
}) {
  const { view } = here;
  const steps = view.steps.filter((s) => s.itemsDue > 0);
  const links = steps.reduce((n, s) => n + s.itemsDue, 0);
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xs ring-1 ring-line">
        <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
          Review
        </div>
        <div className="mt-1 text-[18px] font-semibold text-ink">
          {steps.length} {steps.length === 1 ? "step is" : "steps are"} due
        </div>
        <div className="mt-1 text-[13px] text-muted">
          {links} key {links === 1 ? "link" : "links"} to rebuild from memory,
          about {minutesFor(links)}{" "}
          {minutesFor(links) === 1 ? "minute" : "minutes"}. Each step comes back
          with a little less help than last time
          {steps.length > 1 ? ", in a mixed order" : ""}.
        </div>
        {view.last && (
          <div className="mt-2 text-[12.5px] text-body">
            Last time, unaided: {view.last.unaided} of {view.last.of}
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <SmallBtn primary onClick={() => void here.act("review")}>
            Start the review
          </SmallBtn>
          <button
            onClick={onPath}
            className="text-[12.5px] text-muted hover:text-ink"
          >
            or carry on along the path
          </button>
        </div>
      </div>
    </div>
  );
}

// Over the canvas while a review is open: how long it has been, and the due
// steps in the order they come.
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
  const pathOrder = view.steps
    .map((s) => s.step)
    .filter((id) => review.order.includes(id));
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
        Review
        {review.since !== null &&
          ` · ${review.since} ${review.since === 1 ? "day" : "days"} since your last visit`}
        {` · ${review.order.length} ${review.order.length === 1 ? "step" : "steps"} due`}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        {review.order.map((id, i) => {
          const st = view.steps.find((s) => s.step === id);
          if (!st) return null;
          return (
            <span key={id} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-faint">then</span>}
              <button
                onClick={() => onPick(id)}
                className={`rounded-full px-2 py-0.5 ${current === id ? "bg-primary-soft text-primary-strong ring-1 ring-primary-line" : "text-body hover:bg-panel"}`}
              >
                {st.reviewing ? "" : "✓ "}
                {stepNumber(view, id)} {st.title}
              </button>
            </span>
          );
        })}
        {/* only when it is: two steps can come back in path order */}
        {review.order.length > 1 &&
          review.order.some((id, i) => id !== pathOrder[i]) && (
            <span className="text-[11.5px] text-faint">(mixed order)</span>
          )}
      </div>
    </div>
  );
}

// Beside a review: each key link last time → today, once its step's rebuild
// is checked; Today, unaided; the "which idea is this?" cards once the
// rebuilds are done; and I'm done today.
export function ReviewPanel({
  here,
  review,
}: {
  here: Here;
  review: ReviewView;
}) {
  const { view, act } = here;
  const left = review.order.filter(
    (id) => view.steps.find((s) => s.step === id)?.reviewing,
  ).length;
  return (
    <div className="space-y-3">
      <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
        Last time → today
      </div>
      {review.items.length ? (
        <ul className="space-y-1.5">
          {review.items.map((it, i) => (
            <li key={i} className="text-[12px] leading-snug">
              <div className="text-body">{it.label}</div>
              <div>
                <span className={howCls(it.last)}>
                  {it.last ? HOW[it.last] : "first review"}
                </span>
                <span className="text-faint"> → </span>
                <span className={`font-medium ${howCls(it.today)}`}>
                  {HOW[it.today]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[12px] text-muted">
          Each step's links show here once you check its rebuild.
        </div>
      )}
      <div className="rounded-lg bg-panel px-2.5 py-2">
        <div className="text-[11px] text-muted">Today, unaided</div>
        <div className="text-[16px] font-semibold text-ink">
          {review.unaided} of {review.of}
          <span className="ml-1 text-[11.5px] font-normal text-muted">
            key links{left ? " so far" : ""}
          </span>
        </div>
        {left > 0 && (
          <div className="text-[11.5px] text-muted">
            {left} {left === 1 ? "step" : "steps"} left to rebuild
          </div>
        )}
      </div>

      {review.cards.length > 0 && (
        <div className="space-y-2 border-t border-line pt-2">
          <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
            Which idea is this?
          </div>
          {review.cards.map((c) => (
            <div key={c.id} className="space-y-1">
              <div className="text-[12.5px] leading-snug text-ink">{c.ask}</div>
              <div className="flex flex-wrap gap-1">
                {c.choices.map((ch) => {
                  const mine = c.picked === ch.step;
                  return (
                    <button
                      key={ch.step}
                      disabled={c.picked !== null}
                      onClick={() =>
                        void act("idea", { card: c.id, pick: ch.step })
                      }
                      className={`rounded-lg border px-2 py-0.5 text-[12px] ${mine ? (c.right ? "border-success bg-success-soft text-success-strong" : "border-danger bg-danger-soft text-danger-strong") : "border-line-strong text-body hover:border-primary disabled:opacity-60 disabled:hover:border-line-strong"}`}
                    >
                      {ch.title}
                      {mine && (c.right ? " ✓" : " ✗")}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-line pt-2">
        <SmallBtn
          primary={left === 0}
          onClick={() => void act("done")}
          title="What you did not rebuild stays due"
        >
          I'm done today
        </SmallBtn>
        <div className="mt-1 text-[11px] text-faint">
          Nothing here blocks the rest of the map.
        </div>
      </div>
    </div>
  );
}
