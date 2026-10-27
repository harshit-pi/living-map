import type { ReactNode } from "react";

import { Glyph } from "./Glyph.tsx";
import type { Snap } from "./since.ts";
import type { LedgerItem, LedgerView } from "../../shared/ledger.ts";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

// how the last run did, for a chip's hover: when the map was last behind
// the chat and by how much
function lagText(v: LedgerView): string {
  const l = v.health.lag;
  if (!l) return `Filed up to turn ${v.read}`;
  return `Filed up to turn ${v.read}: turn ${l.turn} was on the map ${secs(l.ms)} after it ended (the model took ${secs(l.modelMs)})`;
}

function Health({ v }: { v: LedgerView }) {
  const h = v.health;
  const chip = "shrink-0 rounded-full px-2 py-0.5 text-[11px]";
  if (h.error)
    return (
      <span
        className={`${chip} bg-danger-soft text-danger-strong`}
        title={h.error}
      >
        Couldn't update
      </span>
    );
  if (h.reading)
    return (
      <span className={`${chip} bg-hint-soft text-hint-strong`}>
        Reading {h.reading.done}/{h.reading.total}
      </span>
    );
  if (!h.following)
    return (
      <span
        className={`${chip} bg-panel text-muted`}
        title="The map isn't following your chat right now"
      >
        Paused
      </span>
    );
  // a run under way: the map is reading, not stuck
  if (h.filing) {
    const t = h.filing.turns;
    return (
      <span
        className={`${chip} bg-hint-soft text-hint-strong`}
        title={`Reading turn${t.length === 1 ? "" : "s"} ${t[0]}${t.length > 1 ? `–${t.at(-1)}` : ""} of ${v.turns}. ${lagText(v)}`}
      >
        Filing turn {t.at(-1)}…
      </span>
    );
  }
  if (h.behind > 0)
    return (
      <span
        className={`${chip} bg-warning-soft text-warning-strong`}
        title={`${plural(h.behind, "turn")} to file, up to turn ${v.turns}. ${lagText(v)}`}
      >
        {plural(h.behind, "turn")} behind
      </span>
    );
  return (
    <span
      className={`${chip} bg-success-soft text-success-strong`}
      title={lagText(v)}
    >
      Up to date
    </span>
  );
}

// One line on top: what Claude is on, the first thing waiting on you with
// a count of the rest, and how current the map is.
export function Strip({
  view,
  firstWaiting,
  onWaiting,
  onWaitingLens,
  waitingLens,
  more,
}: {
  view: LedgerView;
  firstWaiting: LedgerItem | null;
  onWaiting: (id: string) => void;
  onWaitingLens: () => void;
  waitingLens: boolean;
  more: ReactNode;
}) {
  const rest = view.strip.waiting.length - (firstWaiting ? 1 : 0);
  return (
    // below 768 px of strip, what waits on you gets a row of its own, so
    // neither it nor what Claude is on is cut to a few letters; measured on
    // the strip itself, so a page zoomed or set in a narrow pane wraps too
    <div className="@container flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface px-3 py-1.5">
      <div
        // idle, it gives the room to what waits on you
        className={`flex min-w-0 items-center gap-1.5 text-[12.5px] @max-3xl:flex-1 ${view.strip.doing || !firstWaiting ? "flex-1" : ""}`}
        title={view.strip.doing ?? undefined}
      >
        <span
          aria-hidden
          className={view.strip.doing ? "text-primary" : "text-faint"}
        >
          ◐
        </span>
        {view.strip.doing ? (
          <span className="truncate text-body">
            <span className="text-muted">Claude: </span>
            <span data-content>{view.strip.doing}</span>
          </span>
        ) : (
          <span className="truncate text-muted">Claude isn't on a task</span>
        )}
      </div>
      {firstWaiting && (
        <div className="flex min-w-0 flex-1 items-center gap-1 @max-3xl:order-last @max-3xl:basis-full">
          <button
            onClick={() => onWaiting(firstWaiting.id)}
            title={`Waiting on you: ${firstWaiting.title}`}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[12.5px] text-warning-strong hover:bg-warning-soft"
          >
            <span aria-hidden>
              <Glyph g="⚑" />
            </span>
            <span className="truncate" data-content>
              {firstWaiting.title}
            </span>
          </button>
          {rest > 0 && (
            <button
              onClick={onWaitingLens}
              title="Light up everything waiting on you"
              className={`shrink-0 rounded-full border px-1.5 text-[11px] ${waitingLens ? "border-warning bg-warning-soft text-warning-strong" : "border-warning-line text-warning-strong hover:bg-warning-soft"}`}
            >
              +{rest}
            </button>
          )}
        </div>
      )}
      <Health v={view} />
      {more}
    </div>
  );
}

// Back after a while: a chip in the toolbar that steps through what was
// filed since you last looked. It sits in the toolbar, not a bar of its own,
// so the map doesn't move down when it appears, and it stays outlined: the
// screen's one filled button belongs to whatever you opened.
export function SinceChip({
  snap,
  at,
  onStep,
  onClose,
}: {
  snap: Snap;
  at: number; // index of the item stepped to, -1 before the first step
  onStep: (to: number) => void;
  onClose: () => void;
}) {
  const n = snap.ids.length;
  const arrow =
    "flex h-7 w-6 items-center justify-center text-[12px] text-primary-strong hover:bg-primary-soft disabled:opacity-40";
  return (
    <div className="flex h-7 shrink-0 items-center overflow-hidden rounded-lg border border-primary-line text-[12px]">
      {at < 0 ? (
        <button
          onClick={() => onStep(0)}
          aria-label="Next new item"
          title="Go to each item filed since you last looked"
          className="flex h-7 items-center gap-1.5 pr-1 pl-2 text-primary-strong hover:bg-primary-soft"
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-primary" />
          {n} new ›
        </button>
      ) : (
        <>
          <button
            className={arrow}
            disabled={at <= 0}
            onClick={() => onStep(at - 1)}
            aria-label="Previous new item"
          >
            ‹
          </button>
          <span className="min-w-8 text-center text-[11px] text-primary-strong tabular-nums">
            {at + 1}/{n} new
          </span>
          <button
            className={arrow}
            disabled={at >= n - 1}
            onClick={() => onStep(at + 1)}
            aria-label="Next new item"
          >
            ›
          </button>
        </>
      )}
      <button
        onClick={onClose}
        aria-label="Close"
        title="Done looking"
        className="flex h-7 w-6 items-center justify-center border-l border-primary-line text-[13px] leading-none text-primary-strong hover:bg-primary-soft"
      >
        ×
      </button>
    </div>
  );
}
