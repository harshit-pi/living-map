import { useEffect, useRef, useState } from "react";

import type { MapSummary } from "../../shared/model.ts";
import { useMaps } from "../lib/api.ts";
import { pluginFor } from "../plugins.ts";

const BADGE = {
  success: "bg-success-soft text-success-strong",
  warning: "bg-warning-soft text-warning-strong",
};

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
    <ul className="divide-y divide-line">
      {maps.slice(0, limit).map((m) => (
        <li key={m.id}>
          <button
            onClick={() => onOpen(m.id)}
            disabled={m.current}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel disabled:cursor-default disabled:bg-primary-soft/50"
          >
            <span
              // one width for every kind, so the titles line up
              className={`w-[62px] shrink-0 rounded-sm py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide ${BADGE[pluginFor(m.purpose)?.badge ?? "warning"]}`}
            >
              {m.purpose}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-ink">
                {m.title}
              </span>
              <span className="block text-[11px] text-muted">
                {m.summary ?? `${m.nodes} nodes · ${m.open} open`}
              </span>
            </span>
            <span className="shrink-0 text-[11px] text-faint">
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
    // Esc closes the menu, as it does a popover: heard first and kept from
    // the app's own Esc, which would also close the panel under it
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="whitespace-nowrap rounded-lg border border-line-strong px-2.5 py-1.5 text-sm text-body hover:bg-panel"
      >
        Maps ▾
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 max-h-[70vh] w-[420px] overflow-y-auto rounded-xl bg-surface shadow-xl ring-1 ring-line">
          <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
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
            <div className="px-3 py-4 text-sm text-muted">No maps yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
