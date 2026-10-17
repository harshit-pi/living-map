import { useState } from "react";

import type { Purpose } from "../../shared/model.ts";
import { Logo } from "../components/Logo.tsx";
import { MapRows } from "../components/MapList.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { useMaps } from "../lib/api.ts";
import { store, stored } from "../lib/storage.ts";
import { PLUGINS } from "../plugins.ts";

type Mode = {
  id: Purpose;
  order?: number;
  label: string;
  heading: string;
  blurb: string;
  placeholder: string;
  examples: string[];
};

// Learn is built in; every other mode is a plugin. They show in `order`.
const MODES: Mode[] = [
  {
    id: "learn",
    order: 20,
    label: "Learn",
    heading: "What do you want to understand?",
    blurb:
      "Any subject. Claude draws it in the shape that fits and leaves the key parts blank for you to fill.",
    placeholder:
      "e.g. a protocol, a theory, a period of history, a coding problem",
    examples: [
      "How TCP opens a connection",
      "What drives an option price (Black–Scholes)?",
      "Why did World War I start?",
      "LeetCode 146: LRU Cache",
    ],
  },
  ...PLUGINS,
].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

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
  const maps = useMaps(true);
  // an older browser may remember "decide", which is now "explore"
  const [purpose, setPurpose] = useState<Purpose>(() => {
    const p = stored<string>("purpose", "explore");
    return MODES.some((m) => m.id === p) ? p : "explore";
  });
  const go = (text: string) => {
    if (text.trim()) onStart(text.trim(), purpose);
  };
  const mode = MODES.find((m) => m.id === purpose) ?? MODES[0];
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
            <button
              onClick={() => go(q)}
              disabled={!q.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary disabled:opacity-40"
            >
              ↑
            </button>
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
        {onCancel && (
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
          {mode.examples.map((e) => (
            <button
              key={e}
              onClick={() => go(e)}
              className="rounded-full border border-line-strong bg-surface px-3 py-1 text-sm text-body hover:border-primary"
            >
              {e}
            </button>
          ))}
        </div>
        {maps.length > 0 && (
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
