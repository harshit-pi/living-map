import type { Here } from "./view.ts";
import type { StepView } from "../shared.ts";

// A way out of a step you cannot do, under its check card: the answer, once
// you have tried (it goes in the step's thread and counts as shown), and
// moving on without it. Quiet text, never the filled button: building is
// still the one next thing.
export function StuckLinks({
  here,
  st,
  onAnswer,
  onSkip,
}: {
  here: Here;
  st: StepView;
  onAnswer: () => void;
  onSkip: () => void;
}) {
  const tried = st.checks > 0 || !!st.check;
  const asking = here.pending("answerStep", { step: st.step });
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      {tried ? (
        <button
          disabled={here.busy || asking}
          title="Claude writes the answer in this step's thread. It counts as shown, and the step comes back to rebuild."
          onClick={onAnswer}
          className="text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-40"
        >
          {asking ? "Writing the answer…" : "Show me the answer"}
        </button>
      ) : (
        <span />
      )}
      <button
        onClick={onSkip}
        title="Go on to the next step; this one waits, marked skipped"
        className="text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Skip for now →
      </button>
    </div>
  );
}

// Every step seen, not every step built: said plainly, with the first step
// still to build as the one next thing, and the whole answer for when you
// want it.
export function EndCard({
  here,
  seen,
  built,
  first,
  onBuild,
  onFull,
}: {
  here: Here;
  seen: number;
  built: number;
  first: { step: string; at: number } | null;
  onBuild: (step: string) => void;
  onFull: () => void;
}) {
  const asking = here.pending("fullAnswer");
  return (
    <div className="space-y-3">
      <div className="text-[14px] font-medium text-ink">
        You've seen all {seen} steps and built {built}.
      </div>
      {first && (
        <button
          data-primary
          onClick={() => onBuild(first.step)}
          className="w-full rounded-lg bg-primary py-1.5 text-sm font-medium text-on-primary hover:bg-primary-strong"
        >
          Build step {first.at}
        </button>
      )}
      <button
        disabled={here.busy || asking}
        title="Claude writes the whole answer in the question's thread. No step counts as built."
        onClick={onFull}
        className="w-full text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-40"
      >
        {asking ? "Writing the answer…" : "Show me the full answer"}
      </button>
    </div>
  );
}
