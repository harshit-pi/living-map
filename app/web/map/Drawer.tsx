import { useState } from "react";

import { groupsOf, topicOf } from "./lens.ts";
import { lookOf } from "./look.ts";
import type {
  ChangeStatement,
  LedgerAction,
  LedgerItem,
} from "../../shared/ledger.ts";

const MARK: Record<ChangeStatement["change"], string> = {
  added: "+",
  removed: "−",
  changed: "~",
};
const MARK_CLS: Record<ChangeStatement["change"], string> = {
  added: "text-success-strong",
  removed: "text-danger-strong",
  changed: "text-warning-strong",
};
const REVIEWS: { id: NonNullable<ChangeStatement["review"]>; label: string }[] =
  [
    { id: "expected", label: "Expected" },
    { id: "unwanted", label: "Not wanted" },
    { id: "unsure", label: "Not sure" },
  ];

// The same items as rows, grouped by state, sliding over the map's right
// side; what changed in your system this session at the end, by module.
export function Drawer({
  open,
  items,
  changes,
  changesFirst,
  selected,
  onPick,
  onReview,
  onClose,
}: {
  open: boolean;
  items: LedgerItem[];
  changes: ChangeStatement[];
  changesFirst: boolean;
  selected: string | null;
  onPick: (id: string) => void;
  onReview: (a: LedgerAction) => void;
  onClose: () => void;
}) {
  const [minor, setMinor] = useState(false);
  const groups = groupsOf(items);
  const low = changes.filter((c) => c.low).length;
  const shown = changes.filter((c) => minor || !c.low);
  const modules = [...new Set(shown.map((c) => c.module))];

  const changeList = changes.length > 0 && (
    <section key="changes" className="px-3 pt-3">
      <h3 className="text-[11px] font-medium tracking-wide text-muted uppercase">
        Changed in your system
      </h3>
      {modules.map((m) => (
        <div key={m} className="mt-2">
          <div className="text-[11.5px] font-medium text-body" data-content>
            {m}
          </div>
          <ul className="mt-1 space-y-1.5">
            {shown
              .filter((c) => c.module === m)
              .map((c) => (
                <li key={c.id} className="rounded-lg border border-line p-2">
                  <div className="flex items-start gap-1.5 text-[12.5px]">
                    <span
                      aria-label={c.change}
                      className={`w-3 shrink-0 text-center font-semibold ${MARK_CLS[c.change]}`}
                    >
                      {MARK[c.change]}
                    </span>
                    <span className="min-w-0 flex-1 text-ink" data-content>
                      {c.text}
                    </span>
                    <span className="shrink-0 text-[11px] text-faint">
                      turn {c.turn}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-4">
                    {REVIEWS.map((r) => (
                      <button
                        key={r.id}
                        aria-pressed={c.review === r.id}
                        onClick={() =>
                          onReview({
                            type: "review",
                            change: c.id,
                            review: r.id,
                          })
                        }
                        className={`rounded-md border px-1.5 py-0.5 text-[11px] ${c.review === r.id ? "border-ink bg-panel text-ink" : "border-line text-muted hover:bg-panel"}`}
                      >
                        {c.review === r.id ? `✓ ${r.label}` : r.label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
          </ul>
        </div>
      ))}
      {low > 0 && (
        <button
          onClick={() => setMinor((v) => !v)}
          className="mt-2 text-[11.5px] text-muted underline underline-offset-2"
        >
          {minor ? "Hide minor changes" : `Show ${low} minor changes`}
        </button>
      )}
    </section>
  );

  const itemList = groups.map((g) => (
    <section key={g.id} className="px-3 pt-3">
      <h3 className="text-[11px] font-medium tracking-wide text-muted uppercase">
        {g.label} <span className="text-faint">{g.items.length}</span>
      </h3>
      <ul className="mt-1">
        {g.items.map((i) => {
          const look = lookOf(i);
          const topic = topicOf(items, i.id);
          return (
            <li key={i.id}>
              <button
                onClick={() => onPick(i.id)}
                className={`flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-panel ${selected === i.id ? "bg-panel" : ""}`}
              >
                <span
                  aria-hidden
                  className={`w-3 shrink-0 text-center text-[12px] ${look.title}`}
                >
                  {look.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    data-content
                    className={`block text-[12.5px] leading-snug ${look.title}`}
                  >
                    {i.title}
                  </span>
                  {topic && (
                    <span
                      data-content
                      className="block truncate text-[11px] text-faint"
                    >
                      {topic.title}
                    </span>
                  )}
                </span>
                {i.isNew && (
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  ));

  return (
    <aside
      aria-hidden={!open}
      inert={!open}
      className={`absolute top-0 right-0 bottom-0 z-20 flex w-[min(360px,100%)] flex-col bg-surface shadow-xl ring-1 ring-line transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
    >
      <div className="flex items-center border-b border-line px-3 py-2">
        <div className="flex-1 text-[13px] font-medium text-ink">List</div>
        <button
          onClick={onClose}
          aria-label="Close the list"
          className="px-1 text-[16px] leading-none text-muted hover:text-ink"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {groups.length === 0 && !changes.length && (
          <p className="px-3 pt-4 text-[12.5px] text-muted">
            Nothing filed yet.
          </p>
        )}
        {changesFirst ? [changeList, ...itemList] : [...itemList, changeList]}
      </div>
    </aside>
  );
}
