import { useEffect, useRef, useState } from "react";

import type { MapSummary } from "../../shared/model.ts";
import { useMaps } from "../lib/api.ts";

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// Earlier maps, newest first: what it was, which mode, how far you got.
export function MapRows({
  maps,
  onOpen,
  limit,
}: {
  maps: MapSummary[];
  onOpen: (id: string) => void;
  limit?: number;
}) {
  return (
    <ul className="divide-y divide-cl-line">
      {maps.slice(0, limit).map((m) => (
        <li key={m.id}>
          <button
            onClick={() => onOpen(m.id)}
            disabled={m.current}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-cl-panel disabled:cursor-default disabled:bg-orange-50/50"
          >
            <span
              className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${m.purpose === "learn" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"}`}
            >
              {m.purpose}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-cl-ink">
                {m.title}
              </span>
              <span className="block text-[11px] text-cl-mute">
                {m.purpose === "learn"
                  ? `${m.done} worked out · ${m.open} to go`
                  : `${m.nodes} nodes · ${m.open} open`}
                {m.form ? ` · ${m.form}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-[11px] text-cl-faint">
              {m.current ? "open now" : ago(m.updatedAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MapsMenu({ onOpen }: { onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const maps = useMaps(open);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-cl-line2 px-2.5 py-1.5 text-sm text-cl-text hover:bg-cl-panel"
      >
        Maps ▾
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 max-h-[70vh] w-[420px] overflow-y-auto rounded-xl bg-white shadow-xl ring-1 ring-cl-line">
          <div className="border-b border-cl-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-cl-faint">
            Your maps
          </div>
          {maps.length ? (
            <MapRows
              maps={maps}
              onOpen={(id) => {
                setOpen(false);
                onOpen(id);
              }}
            />
          ) : (
            <div className="px-3 py-4 text-sm text-cl-mute">No maps yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
