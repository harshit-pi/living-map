import { useState } from "react";

import { Glyph } from "./Glyph.tsx";
import { search, topicOf } from "./lens.ts";
import { lookOf } from "./look.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

// ⌘F over the items' titles: matches light up on the map as you type,
// Enter or a click goes to one.
export function SearchBox({
  items,
  query,
  onQuery,
  onPick,
  onClose,
}: {
  items: LedgerItem[];
  query: string;
  onQuery: (q: string) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [at, setAt] = useState(0);
  const found = search(items, query).slice(0, 8);
  const cur = Math.min(at, Math.max(0, found.length - 1));
  return (
    <div className="absolute top-2 right-2 left-2 z-30 rounded-xl bg-surface shadow-xl ring-1 ring-line sm:left-auto sm:w-[360px]">
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          onQuery(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt(Math.min(cur + 1, found.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt(Math.max(cur - 1, 0));
          } else if (e.key === "Enter" && found[cur]) onPick(found[cur].id);
        }}
        placeholder="Find an item by its title"
        aria-label="Search the map"
        className="w-full rounded-t-xl border-b border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:outline-none"
      />
      {query.trim() && (
        <ul className="max-h-72 overflow-y-auto py-1">
          {found.length === 0 && (
            <li className="px-3 py-1.5 text-[12.5px] text-muted">
              Nothing on the map by that name
            </li>
          )}
          {found.map((i, k) => {
            const look = lookOf(i);
            const topic = i.type === "topic" ? null : topicOf(items, i.id);
            return (
              <li key={i.id}>
                <button
                  onMouseEnter={() => setAt(k)}
                  onClick={() => onPick(i.id)}
                  className={`flex w-full items-start gap-2 px-3 py-1 text-left ${k === cur ? "bg-panel" : ""}`}
                >
                  <span
                    aria-hidden
                    className={`w-3.5 shrink-0 text-center text-[12px] ${look.title}`}
                  >
                    <Glyph g={look.glyph || "▸"} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      data-content
                      className="block truncate text-[12.5px] text-ink"
                    >
                      {i.title}
                    </span>
                    {topic && (
                      <span
                        data-content
                        className="block truncate text-[11px] text-muted"
                      >
                        {topic.title}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
