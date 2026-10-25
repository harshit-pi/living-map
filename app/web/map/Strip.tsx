import type { ReactNode } from "react";

import type { Snap } from "./since.ts";
import type { LedgerItem, LedgerView } from "../../shared/ledger.ts";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

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
  if (h.behind > 0)
    return (
      <span
        className={`${chip} bg-warning-soft text-warning-strong`}
        title={`Filed up to turn ${v.read} of ${v.turns}`}
      >
        {plural(h.behind, "turn")} behind
      </span>
    );
  return (
    <span
      className={`${chip} bg-success-soft text-success-strong`}
      title={`Filed up to turn ${v.read}`}
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
            <span aria-hidden>⚑</span>
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

// Back after a while: what happened since you last looked, and arrows that
// step through exactly those items.
export function SinceBar({
  snap,
  at,
  primary,
  onStep,
  onClose,
}: {
  snap: Snap;
  at: number; // index of the item stepped to, -1 before the first step
  primary: boolean; // the screen's one filled button is free
  onStep: (to: number) => void;
  onClose: () => void;
}) {
  const parts = [
    snap.turns ? plural(snap.turns, "turn") : "",
    snap.waiting ? `${snap.waiting} on you` : "",
    snap.changes ? plural(snap.changes, "change") : "",
    !snap.waiting && snap.ids.length ? `${snap.ids.length} new` : "",
  ].filter(Boolean);
  const n = snap.ids.length;
  const arrow =
    "flex h-6 min-w-6 items-center justify-center rounded-md border border-line-strong px-1.5 text-[12px] text-body hover:bg-panel disabled:opacity-40";
  return (
    <div className="flex items-center gap-2 border-b border-primary-line bg-primary-soft px-3 py-1">
      <div className="min-w-0 flex-1 truncate text-[12.5px] text-primary-strong">
        <span className="font-medium">Since you looked:</span>{" "}
        {parts.join(" · ")}
      </div>
      {n > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            className={arrow}
            disabled={at <= 0}
            onClick={() => onStep(at - 1)}
            aria-label="Previous new item"
          >
            ‹
          </button>
          <span className="min-w-9 text-center text-[11px] text-primary-strong tabular-nums">
            {at < 0 ? `${n} new` : `${at + 1}/${n}`}
          </span>
          <button
            data-primary={primary || undefined}
            className={
              primary
                ? "flex h-6 items-center justify-center rounded-md bg-primary px-2 text-[12px] font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40"
                : arrow
            }
            disabled={at >= n - 1}
            onClick={() => onStep(at + 1)}
            aria-label="Next new item"
          >
            {at < 0 ? "Show ›" : "›"}
          </button>
        </div>
      )}
      <button
        onClick={onClose}
        aria-label="Close"
        title="Done looking"
        className="shrink-0 px-1 text-[14px] leading-none text-primary-strong"
      >
        ×
      </button>
    </div>
  );
}
