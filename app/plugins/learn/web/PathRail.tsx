import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { MapDoc, MapNode } from "../../../shared/model.ts";

const hintsOf = (map: MapDoc, id: string) =>
  Object.values(map.nodes).filter(
    (n) => n.parent === id && n.kind === "fact" && /^hint\b/i.test(n.title),
  ).length;

function stateOf(map: MapDoc, n: MapNode) {
  if (n.dropped)
    return {
      mark: "–",
      cls: "border-line-strong text-faint",
      word: "set aside",
    };
  if (n.revealed)
    return {
      mark: "◉",
      cls: "border-hint bg-hint-soft text-hint-strong",
      word: "answer shown",
    };
  if (n.kind === "question" && n.status === "answered")
    return {
      mark: "✓",
      cls: "border-success bg-success text-on-primary",
      word: "got it",
    };
  const sc = map.scenes?.[n.id];
  if (sc && !sc.done && sc.at > 0)
    return {
      mark: "▶",
      cls: "border-primary bg-primary-soft text-primary-strong",
      word: `playing · ${sc.at} of ${sc.total}`,
    };
  // the badge keeps the step's number; the hint count is in the words
  const h = hintsOf(map, n.id);
  if (h)
    return {
      mark: "",
      cls: "border-warning bg-warning-soft text-warning-strong",
      word: `${h} hint${h > 1 ? "s" : ""} used`,
    };
  return {
    mark: "",
    cls: "border-warning bg-surface text-warning-strong",
    word: "to do",
  };
}

// The path to understanding: the steps in order, each with where you are on it.
export function PathRail({
  map,
  selected,
  onSelect,
  busy,
  workingId,
  onNext,
}: {
  map: MapDoc;
  selected: string | null;
  onSelect: (id: string) => void;
  busy: boolean;
  workingId: string | null;
  onNext: () => void;
}) {
  const root = Object.values(map.nodes).find((n) => !n.parent);
  const kids = root
    ? Object.values(map.nodes)
        .filter((n) => n.parent === root.id)
        .sort((a, b) => a.order - b.order)
    : [];
  const steps = kids.filter((n) => n.kind === "question");
  const notes = kids.filter((n) => n.kind !== "question");
  const subSteps = (id: string) =>
    Object.values(map.nodes)
      .filter((n) => n.parent === id && n.kind === "question")
      .sort((a, b) => a.order - b.order);
  const start = map.chat.find(
    (c) => c.role === "claude" && !c.blankId && !c.nodeId,
  )?.text;
  const got = steps.filter(
    (s) => s.status === "answered" && !s.revealed,
  ).length;
  return (
    <nav className="flex h-full w-[220px] shrink-0 xl:w-[270px] flex-col border-r border-line bg-canvas">
      <div className="px-4 pb-2 pt-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">
          Your path
        </div>
        {root && (
          <button
            onClick={() => onSelect(root.id)}
            className="mt-0.5 text-left text-[15px] font-semibold leading-snug text-ink hover:text-primary-strong"
          >
            {root.title}
          </button>
        )}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{
              width: `${steps.length ? (got / steps.length) * 100 : 0}%`,
            }}
          />
        </div>
        <div className="mt-1 text-xs text-muted">
          {got} of {steps.length} worked out by you
        </div>
        {/* Claude's opening instruction stays here to re-read after its
            caption above the message box has gone */}
        {start && (
          <details className="mt-2 rounded-lg bg-panel px-2.5 py-1.5 text-[12px]">
            <summary className="cursor-pointer text-[11px] font-semibold text-muted">
              How to start
            </summary>
            <div className="answer answer-sm mt-1 max-h-48 overflow-y-auto text-[12.5px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{start}</ReactMarkdown>
            </div>
          </details>
        )}
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {steps.map((s, i) => {
          const st = stateOf(map, s);
          const on = selected === s.id;
          return (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s.id)}
                className={`group flex w-full gap-2.5 rounded-xl px-2 py-2 text-left ${on ? "bg-surface shadow-xs ring-1 ring-inset ring-primary" : "hover:bg-panel"} ${s.fresh ? "fresh" : ""}`}
              >
                <span className="flex flex-col items-center">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold ${st.cls} ${workingId === s.id ? "is-working" : ""}`}
                  >
                    {st.mark || i + 1}
                  </span>
                  {i < steps.length - 1 && (
                    <span className="mt-1 w-px flex-1 bg-line-strong" />
                  )}
                </span>
                <span className="min-w-0 pb-1">
                  <span
                    className={`block text-[13.5px] font-medium leading-snug ${s.dropped ? "text-faint line-through" : "text-ink"}`}
                  >
                    {s.title}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {st.word}
                  </span>
                </span>
              </button>
              {/* smaller steps ("Smaller steps" on a step) sit under it */}
              {subSteps(s.id).map((c) => {
                const cs = stateOf(map, c);
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    className={`ml-9 flex w-[calc(100%-2.25rem)] items-start gap-2 rounded-lg px-2 py-1 text-left ${selected === c.id ? "bg-surface shadow-xs ring-1 ring-inset ring-primary" : "hover:bg-panel"} ${c.fresh ? "fresh" : ""}`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold ${cs.cls} ${workingId === c.id ? "is-working" : ""}`}
                    >
                      {cs.mark}
                    </span>
                    <span
                      className={`text-[12.5px] leading-snug ${c.dropped ? "text-faint line-through" : "text-body"}`}
                    >
                      {c.title}
                    </span>
                  </button>
                );
              })}
            </li>
          );
        })}
        {notes.length > 0 && (
          <li className="mt-3 px-3 text-[10px] font-semibold uppercase tracking-wide text-faint">
            You looked into
          </li>
        )}
        {notes.map((n) => (
          <li key={n.id}>
            <button
              onClick={() => onSelect(n.id)}
              className={`mt-1 w-full rounded-lg px-3 py-1.5 text-left text-xs ${selected === n.id ? "bg-surface ring-1 ring-inset ring-primary" : "text-muted hover:bg-panel"}`}
            >
              {n.kind === "option" ? "◇ " : "· "}
              {n.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="border-t border-line p-3">
        <button
          onClick={onNext}
          disabled={busy}
          className="w-full rounded-lg bg-primary py-1.5 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40"
        >
          Next step ▸
        </button>
      </div>
    </nav>
  );
}
