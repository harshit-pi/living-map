import { Glyph } from "./Glyph.tsx";
import { LENSES, type Lens } from "./lens.ts";

// Each lens wears the mark and colour of the boxes it lights, so the row
// reads as the map's key: amber for what waits on you, the green ◆ of a
// decision.
const KEY: Record<Lens, { glyph: string; mark: string; off: string }> = {
  waiting: {
    glyph: "⚑",
    mark: "text-warning-strong",
    off: "border-warning bg-warning-soft text-warning-strong",
  },
  open: { glyph: "☐", mark: "text-muted", off: "border-line text-body" },
  decided: { glyph: "◆", mark: "text-success", off: "border-line text-body" },
  changed: { glyph: "±", mark: "text-muted", off: "border-line text-body" },
};

// The lenses and the map's tools, under the strip. A lens lights its items
// and dims the rest in place; a second click turns it off.
export function Toolbar({
  lens,
  counts,
  onLens,
  onSearch,
  onNow,
  onList,
  listOpen,
  canNow,
  following,
  step,
}: {
  lens: Lens | null;
  counts: Record<Lens, number>;
  onLens: (l: Lens | null) => void;
  onSearch: () => void;
  onNow: () => void;
  onList: () => void;
  listOpen: boolean;
  canNow: boolean;
  following: boolean; // the camera is on Now's topic, following it
  // with a lens on: stepping through what it lights up, in map order
  step?: { at: number; n: number; onStep: (to: number) => void };
}) {
  const tool =
    "flex h-7 shrink-0 items-center justify-center rounded-lg border px-2 text-[12px]";
  return (
    // on a narrow pane the lenses take a row of their own rather than
    // scrolling out of sight
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-canvas px-3 py-1.5">
      <div className="flex min-w-0 flex-[1_1_100%] flex-wrap items-center gap-1 min-[560px]:flex-[1_1_0%]">
        {LENSES.map((l) => {
          const on = lens === l.id;
          return (
            <button
              key={l.id}
              onClick={() => onLens(on ? null : l.id)}
              aria-pressed={on}
              title={
                on
                  ? `Turn off ${l.label}`
                  : `Light up ${l.label.toLowerCase()} items`
              }
              className={`${tool} gap-1 ${on ? "border-ink bg-surface font-medium text-ink" : `${KEY[l.id].off} hover:bg-panel`}`}
            >
              <span aria-hidden className={KEY[l.id].mark}>
                <Glyph g={KEY[l.id].glyph} />
              </span>
              {l.label}
              <span
                className={`tabular-nums ${on ? "text-ink" : "text-muted"} ${l.id === "waiting" && counts.waiting ? "font-semibold text-warning-strong" : ""}`}
              >
                {counts[l.id]}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {step && step.n > 0 && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              className={`${tool} w-7 border-line px-0 text-body hover:bg-panel disabled:opacity-40`}
              disabled={step.at <= 0}
              onClick={() => step.onStep(step.at - 1)}
              aria-label="Previous lit item"
            >
              ‹
            </button>
            <span className="min-w-8 text-center text-[11px] text-muted tabular-nums">
              {step.at < 0 ? `–/${step.n}` : `${step.at + 1}/${step.n}`}
            </span>
            <button
              className={`${tool} w-7 border-line px-0 text-body hover:bg-panel disabled:opacity-40`}
              disabled={step.at >= step.n - 1}
              onClick={() => step.onStep(step.at + 1)}
              aria-label="Next lit item"
              title="Go to each lit item in turn"
            >
              ›
            </button>
          </div>
        )}
        <button
          onClick={onSearch}
          title="Search titles (⌘F)"
          aria-label="Search"
          className={`${tool} border-line text-body hover:bg-panel`}
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5 14 14" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={onNow}
          disabled={!canNow}
          aria-pressed={following}
          title={
            following
              ? "Following the topic Claude is on; move the map to stop"
              : "Go to the topic Claude is on now, and follow it"
          }
          className={`${tool} disabled:opacity-40 ${following ? "border-ink bg-surface text-ink" : "border-line text-body hover:bg-panel"}`}
        >
          Now
        </button>
        <button
          onClick={onList}
          aria-pressed={listOpen}
          title="The same items as a list"
          className={`${tool} ${listOpen ? "border-ink bg-surface text-ink" : "border-line text-body hover:bg-panel"}`}
        >
          List
        </button>
      </div>
    </div>
  );
}
