import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { UpdateStep } from "../../shared/model.ts";
import { useUpdate } from "../lib/api.ts";

// "Update available" in the header when a newer release is out. One click pulls
// it, installs, builds and restarts; the page then reloads into the new version.
export function UpdateButton({ steps }: { steps: UpdateStep[] }) {
  const { info, refresh } = useUpdate();
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState<string | null>(null); // the version running when Update was pressed
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  // after a restart the server runs the new version: reload into it
  const restarting = steps.some((s) => s.step === "Restarting");
  useEffect(() => {
    if (!restarting || !started) return;
    const t = setInterval(async () => {
      const i = await refresh();
      if (i && i.current.sha && i.current.sha !== started) location.reload();
    }, 2000);
    return () => clearInterval(t);
  }, [restarting, started, refresh]);

  if (!info?.available && !started) return null;
  const failed = steps.find((s) => s.state === "failed");

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg bg-primary-soft px-2.5 py-1.5 text-sm font-medium text-primary-strong ring-1 ring-primary-line hover:bg-primary-line"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {started ? "Updating…" : "Update available"}
      </button>
      {open && info && (
        <div className="absolute top-10 right-0 z-40 w-[400px] rounded-xl bg-surface p-4 shadow-xl ring-1 ring-line">
          <div className="text-[15px] font-semibold text-ink">
            Living Map {info.latest?.version} is out
          </div>
          <div className="mt-0.5 text-xs text-muted">
            You have {info.current.version}
            {info.behind > 0 &&
              ` · ${info.behind} change${info.behind > 1 ? "s" : ""} behind`}
          </div>
          {info.latest?.notes && (
            <div className="answer answer-sm mt-3 max-h-48 overflow-y-auto rounded-lg bg-panel px-3 py-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {info.latest.notes}
              </ReactMarkdown>
            </div>
          )}

          {steps.length > 0 && (
            <ol className="mt-3 space-y-1 text-[13px]">
              {steps.map((s) => (
                <li key={s.step} className="flex gap-2">
                  <span
                    className={
                      s.state === "done"
                        ? "text-success"
                        : s.state === "failed"
                          ? "text-danger"
                          : "animate-pulse text-primary"
                    }
                  >
                    {s.state === "done"
                      ? "✓"
                      : s.state === "failed"
                        ? "✗"
                        : "●"}
                  </span>
                  <span className="text-body">
                    {s.step}
                    {s.message && (
                      <span className="block text-xs text-muted">
                        {s.message}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            {info.latest && (
              <a
                href={info.latest.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted hover:text-ink"
              >
                Release notes on GitHub ↗
              </a>
            )}
            {info.canUpdate ? (
              <button
                disabled={!!started && !failed}
                onClick={async () => {
                  setStarted(info.current.sha);
                  await fetch("/api/update", { method: "POST" });
                }}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40"
              >
                {failed ? "Try again" : started ? "Updating…" : "Update now"}
              </button>
            ) : (
              <span className="max-w-[240px] text-right text-xs text-muted">
                {info.reason}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
