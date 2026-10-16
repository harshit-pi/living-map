import { useState } from "react";

import type { Purpose } from "../../shared/model.ts";
import { MapRows } from "../components/MapList.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { useMaps } from "../lib/api.ts";
import { store, stored } from "../lib/storage.ts";

const EXAMPLES: Record<Purpose, string[]> = {
  explore: [
    "Which learning vertical should Living Map start with?",
    "Postgres or DynamoDB for a new service?",
  ],
  learn: [
    "How TCP opens a connection",
    "What drives an option price (Black–Scholes)?",
    "Why did World War I start?",
    "LeetCode 146: LRU Cache",
  ],
};

export function StartScreen({
  error,
  onStart,
  onCancel,
  onOpen,
}: {
  error: string;
  onStart: (text: string, purpose: Purpose) => void;
  onCancel?: () => void;
  onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const maps = useMaps(true);
  // an older browser may remember "decide", which is now "explore"
  const [purpose, setPurpose] = useState<Purpose>(() =>
    stored<string>("purpose", "explore") === "learn" ? "learn" : "explore",
  );
  const go = (text: string) => {
    if (text.trim()) onStart(text.trim(), purpose);
  };
  const learn = purpose === "learn";
  return (
    <div className="flex h-full items-center justify-center bg-cl-bg p-6">
      <div className="w-full max-w-xl">
        <div className="mb-4 flex justify-center">
          <Segmented
            value={purpose}
            options={[
              ["explore", "Explore"],
              ["learn", "Learn"],
            ]}
            onChange={(p) => {
              setPurpose(p);
              store("purpose", p);
            }}
          />
        </div>
        <h1 className="text-center font-serif text-3xl text-cl-ink">
          {learn
            ? "What do you want to understand?"
            : "What do you want to think through?"}
        </h1>
        <p className="mt-2 text-center text-cl-mute">
          {learn
            ? "Any subject. Claude draws it in the shape that fits and leaves the key parts blank for you to fill."
            : "A question to explore or a choice to make. Claude lays it out as a map; you steer by clicking and replying on the nodes."}
        </p>
        <div className="mt-6 rounded-2xl border border-cl-line2 bg-white shadow-xs focus-within:border-cl-accent">
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
            placeholder={
              learn
                ? "e.g. a protocol, a theory, a period of history, a coding problem"
                : "e.g. Which database for the new service?"
            }
            className="block w-full resize-none border-0 bg-transparent px-4 pt-3 text-base outline-hidden focus:ring-0"
          />
          <div className="flex justify-end px-2 pb-2">
            <button
              onClick={() => go(q)}
              disabled={!q.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-cl-accent text-white disabled:opacity-40"
            >
              ↑
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </div>
        )}
        {onCancel && (
          <div className="mt-3 text-center">
            <button
              onClick={onCancel}
              className="text-sm text-cl-mute hover:text-cl-ink"
            >
              ← Back to the current map
            </button>
          </div>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {EXAMPLES[purpose].map((e) => (
            <button
              key={e}
              onClick={() => go(e)}
              className="rounded-full border border-cl-line2 bg-white px-3 py-1 text-sm text-cl-text hover:border-cl-accent"
            >
              {e}
            </button>
          ))}
        </div>
        {maps.length > 0 && (
          <div className="mt-8">
            <div className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-cl-faint uppercase">
              Pick up where you left off
            </div>
            <div className="overflow-hidden rounded-xl bg-white ring-1 ring-cl-line">
              <MapRows maps={maps} onOpen={onOpen} limit={6} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
