import { WorkingBar } from "../components/WorkingBar.tsx";
import type { Live } from "../lib/live.ts";

// While a new map is being laid out: what the model is doing, and what it has written so far.
export function LoadingScreen({
  live,
  onStop,
}: {
  live: Live;
  onStop: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <WorkingBar working={live.working} queued={live.queued} onStop={onStop} />
      <div className="flex flex-1 items-center justify-center text-muted">
        <div className="max-w-md text-center">
          <div className="animate-pulse">
            {live.working?.label ?? "Starting"}…
          </div>
          <div className="mt-3 text-sm text-faint">{live.stream.text}</div>
        </div>
      </div>
    </div>
  );
}
