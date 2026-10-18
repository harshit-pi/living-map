import { useEffect, useState } from "react";

import type { Purpose } from "../../shared/model.ts";
import { Logo } from "../components/Logo.tsx";
import { MapRows } from "../components/MapList.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { ago, reviewMinutes } from "../lib/ago.ts";
import { useMapList } from "../lib/api.ts";
import { store, stored } from "../lib/storage.ts";
import { PLUGINS } from "../plugins.ts";

// every mode is a plugin; they show in `order`
const MODES = [...PLUGINS].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

export function StartScreen({
  error,
  working,
  onStart,
  onCancel,
  onOpen,
}: {
  error: string;
  // what Claude is still doing on the open map, if anything
  working: string | null;
  onStart: (text: string, purpose: Purpose) => void;
  onCancel?: () => void;
  onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMapList(true);
  const maps = list ?? [];
  const [listing, setListing] = useState(false);
  // an older browser may remember "decide", which is now "explore"
  const [purpose, setPurpose] = useState<Purpose>(() => {
    const p = stored<string>("purpose", "explore");
    return MODES.some((m) => m.id === p) ? p : "explore";
  });
  const go = (text: string) => {
    if (text.trim()) onStart(text.trim(), purpose);
  };
  const mode = MODES.find((m) => m.id === purpose) ?? MODES[0];
  // The simpler start screen: the examples are a first visit's way in, and
  // your maps (with the one open now, which is the way back) wait behind one
  // "Your maps ▾" once there are any. A list of three maps and a back link
  // were 60 more words than the box and its two examples.
  const simple = !!mode.simple;
  const firstVisit = list !== null && list.length === 0;
  // Esc goes back to the map you came from, as the back link did
  useEffect(() => {
    if (!simple || !onCancel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [simple, onCancel]);
  // maps with review items due now, most due first: opening one opens it on
  // its review
  const due = maps
    .filter((m) => (m.due?.now ?? 0) > 0)
    .sort((a, b) => b.due!.now - a.due!.now);
  return (
    // scrolls when the window is short, instead of cutting off the top; held
    // at a fixed height, not centred, so the mode switch stays put between modes
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-6 pt-[max(2rem,12vh)] pb-8">
        <div className="mb-6 flex justify-center">
          <Logo size={30} />
        </div>
        <div className="mb-4 flex justify-center">
          <Segmented
            value={purpose}
            filled={!!mode.simple}
            options={MODES.map((m) => [m.id, m.label])}
            onChange={(p) => {
              setPurpose(p);
              store("purpose", p);
            }}
          />
        </div>
        <h1 className="text-center font-serif text-3xl text-ink">
          {mode.heading}
        </h1>
        <p className="mt-2 text-center text-muted">{mode.blurb}</p>
        <div className="mt-6 rounded-2xl border border-line-strong bg-surface shadow-xs focus-within:border-primary">
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                go(q);
              }
            }}
            placeholder={mode.placeholder}
            className="block w-full resize-none border-0 bg-transparent px-4 pt-3 text-base outline-hidden focus:ring-0"
          />
          <div className="flex justify-end px-2 pb-2">
            {mode.simple ? (
              // a word, not an arrow: the one thing this screen asks of you
              <button
                data-primary
                onClick={() => go(q)}
                disabled={!q.trim()}
                className="h-8 rounded-lg bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40"
              >
                Start
              </button>
            ) : (
              <button
                onClick={() => go(q)}
                disabled={!q.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary disabled:opacity-40"
              >
                ↑
              </button>
            )}
          </div>
        </div>
        {working !== null && (
          <div className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-strong">
            Claude is still working on the open map
            {working ? ` (${working.toLowerCase()})` : ""}. Starting or opening
            another map stops it.
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-strong">
            {error}
          </div>
        )}
        {onCancel && !simple && (
          <div className="mt-3 text-center">
            <button
              onClick={onCancel}
              className="text-sm text-muted hover:text-ink"
            >
              ← Back to the current map
            </button>
          </div>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {(!simple || firstVisit ? mode.examples : []).map((e) => (
            <button
              key={e}
              onClick={() => go(e)}
              className="rounded-full border border-line-strong bg-surface px-3 py-1 text-sm text-body hover:border-primary"
            >
              {e}
            </button>
          ))}
        </div>
        {due.length > 0 && (
          <div className="mt-8">
            <div className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
              Due for review
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-primary-line">
              {due.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() =>
                      m.current && onCancel ? onCancel() : onOpen(m.id)
                    }
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel"
                  >
                    <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft px-1.5 text-[11px] font-semibold text-primary-strong">
                      ↻ {m.due!.now}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-ink">
                        {m.title}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {/* steps due, as the map's own review counts them; a
                            step's rebuild takes two or three minutes */}
                        {m.due!.now} {m.due!.now === 1 ? "step" : "steps"} due ·
                        about {reviewMinutes(m.due!.now)} min · last seen{" "}
                        {m.current ? "now" : ago(m.updatedAt)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] font-medium text-primary-strong">
                      Review →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {maps.length > 0 && simple && (
          <div className="mt-6 text-center">
            <button
              onClick={() => setListing((v) => !v)}
              aria-expanded={listing}
              className="text-sm text-muted hover:text-ink"
            >
              Your maps {listing ? "▴" : "▾"}
            </button>
            {listing && (
              <div className="mt-2 overflow-hidden rounded-xl bg-surface text-left ring-1 ring-line">
                <MapRows
                  maps={maps}
                  onOpen={onOpen}
                  onCurrent={onCancel}
                  limit={6}
                />
              </div>
            )}
          </div>
        )}
        {maps.length > 0 && !simple && (
          <div className="mt-8">
            <div className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
              Pick up where you left off
            </div>
            <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-line">
              <MapRows maps={maps} onOpen={onOpen} limit={6} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
