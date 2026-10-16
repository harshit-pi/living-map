import { useEffect, useState } from "react";

import type { Working } from "../../shared/model.ts";

// What the model is doing right now: a moving bar, the task, the seconds so
// far, what waits behind it, and Stop.
export function WorkingBar({
  working,
  queued,
  onStop,
}: {
  working: Working | null;
  queued: number;
  onStop: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [working]);
  if (!working) return <div className="h-[2px]" />;
  const secs = Math.max(0, Math.round((now - working.since) / 1000));
  return (
    <div className="relative">
      <div className="working-bar" />
      <div className="absolute top-1.5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white py-1 pr-1 pl-3 text-xs text-cl-text shadow-md ring-1 ring-cl-line">
        <span className="h-2 w-2 animate-pulse rounded-full bg-cl-accent" />
        <span>
          Claude · {working.label}…{" "}
          <span className="text-cl-faint tabular-nums">{secs}s</span>
          {queued > 0 && (
            <span className="text-cl-accentDk"> · {queued} waiting</span>
          )}
        </span>
        <button
          onClick={onStop}
          className="rounded-full px-2 py-0.5 text-cl-mute hover:bg-cl-panel hover:text-cl-ink"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
