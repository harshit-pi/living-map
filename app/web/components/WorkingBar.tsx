import { useEffect, useState } from "react";

import type { Working } from "../../shared/model.ts";

type Props = {
  working: Working | null;
  queued: number;
  onStop: () => void;
  // the task without "Claude ·": "Claude · 24s" alone left a newcomer
  // wondering whether to wait (a next step drawn while you build, a
  // pre-mortem after a choice), so the few words of what it is stay
  compact?: boolean;
};

// What the model is doing right now: the task, the seconds so far, what waits
// behind it, and Stop. It sits in the header, so it never covers the work.
export function WorkingPill({ working, queued, onStop, compact }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [working]);
  if (!working) return null;
  const secs = Math.max(0, Math.round((now - working.since) / 1000));
  // a move Next started is known to the server as "Next: …"; the pill says
  // what it does, not which button sent it
  const label = compact ? working.label.replace(/^Next: /, "") : working.label;
  return (
    <div
      title={compact ? `Claude: ${label}…` : undefined}
      className="flex min-w-0 items-center gap-2 rounded-full bg-surface py-1 pr-1 pl-3 text-xs text-body shadow-xs ring-1 ring-line"
    >
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
      <span className="truncate">
        {compact ? `${label}…` : `Claude · ${label}…`}{" "}
        <span className="text-faint tabular-nums">{`${secs}s`}</span>
        {queued > 0 && (
          <span className="text-primary-strong"> · {queued} waiting</span>
        )}
      </span>
      <button
        onClick={onStop}
        className="shrink-0 rounded-full px-2 py-0.5 text-muted hover:bg-panel hover:text-ink"
      >
        Stop
      </button>
    </div>
  );
}

// The moving line under the header while the model works; with `pill`, the
// pill floats on it (the loading screen, which has no header).
export function WorkingBar({
  pill = true,
  ...props
}: Props & { pill?: boolean }) {
  if (!props.working) return <div className="h-[2px]" />;
  return (
    <div className="relative">
      <div className="working-bar" />
      {pill && (
        <div className="absolute top-1.5 left-1/2 z-30 -translate-x-1/2">
          <WorkingPill {...props} />
        </div>
      )}
    </div>
  );
}
