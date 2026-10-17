import { ReactFlowProvider, useStore, useViewport } from "@xyflow/react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  DesignCanvas,
  NODE_W,
  PALETTE_W,
  type Picked,
} from "./DesignCanvas.tsx";
import { fmt, named, STATUS_TONE } from "./format.ts";
import type { ChatLine } from "../../../shared/model.ts";
import { FloatingComposer } from "../../../web/components/FloatingComposer.tsx";
import { NodePanel } from "../../../web/components/NodePanel.tsx";
import type { Workspace } from "../../../web/lib/workspace.ts";
import {
  KINDS,
  PLUGIN_ID,
  type DesignView,
  type Reference,
  type ReviewPoint,
} from "../shared.ts";

const REVIEWING = "Reviewing your design";
const CHECK = "Check my design."; // what a check says in the conversation

// Design: the brief and the deep dives on the left; the canvas you build on in
// the middle, with the palette; Claude's review and the selected part on top.
export function DesignScreen({ ws }: { ws: Workspace }) {
  // the provider wraps the whole screen, so the inspector can sit by its part.
  // Each map gets its own: another map opens fitted to its design, with its
  // own review and its reference hidden until you ask on that map.
  return (
    <ReactFlowProvider key={ws.map.id}>
      <Design ws={ws} />
    </ReactFlowProvider>
  );
}

function Design({ ws }: { ws: Workspace }) {
  const { map, live, selection, setSelection, roomy } = ws;
  const run = ws.run;
  const view = (map.data?.[PLUGIN_ID] ?? null) as DesignView | null;
  const [picked, setPicked] = useState<Picked>(null);
  const [hover, setHover] = useState<string[]>([]);
  const [showReference, setShowReference] = useState(false);
  const [sure, setSure] = useState(false);
  // a new review opens; you can fold it away until the next one
  const [folded, setFolded] = useState<number | null>(null);
  // set from the click until the review is back, so a second click asks nothing
  const [checking, setChecking] = useState(false);
  // what you just removed, with Undo (also Cmd/Ctrl+Z) for a few seconds
  const [undo, setUndo] = useState<{ what: string; at: number } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "z" &&
        !el?.closest("input, textarea, [contenteditable]")
      ) {
        e.preventDefault();
        setUndo(null);
        void run({ type: "plugin", plugin: PLUGIN_ID, name: "undo", args: {} });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [undo, run]);
  const open = selection.length === 1 ? map.nodes[selection[0]] : undefined;
  // the review steps aside while a deep dive's panel is open
  const reviewOpen =
    !!view?.review && folded !== view.review.at && !showReference && !open;
  const act = (name: string, args: Record<string, unknown> = {}) => {
    if (name === "remove") {
      const c = view?.comps.find((x) => x.id === args.id);
      if (c) setUndo({ what: `"${c.label}"`, at: Date.now() });
    }
    if (name === "unwire") {
      const w = view?.wires.find((x) => x.id === args.id);
      const label = (id?: string) =>
        view?.comps.find((c) => c.id === id)?.label ?? "";
      if (w)
        setUndo({
          what: `the wire "${label(w.from)}" → "${label(w.to)}"`,
          at: Date.now(),
        });
    }
    if (name === "undo") setUndo(null);
    return run({ type: "plugin", plugin: PLUGIN_ID, name, args });
  };

  const root = Object.values(map.nodes).find((n) => !n.parent);
  const dives = Object.values(map.nodes)
    .filter((n) => root && n.parent === root.id && n.kind === "question")
    .sort((a, b) => a.order - b.order);
  const reviewing = live.working?.label === REVIEWING;

  if (!view)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Writing the brief…
      </div>
    );

  const over = view.comps.filter((c) => view.load[c.id]?.status === "over");
  const ref = showReference ? view.reference : null;
  // the last check was stopped (a new map, Stop) before its review came back
  const lastCheck = map.chat.findLastIndex(
    (c) => c.role === "you" && c.text === CHECK,
  );
  const checkStopped =
    lastCheck >= 0 &&
    !reviewing &&
    !checking &&
    !map.chat
      .slice(lastCheck + 1)
      .some((c) => c.role === "claude" && !c.nodeId) &&
    map.chat
      .slice(lastCheck + 1)
      .some((c) => c.role === "system" && /^(Stopped|Cancelled)/.test(c.text));
  return (
    <div className="flex h-full">
      <aside className="flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface xl:w-[300px]">
        <Brief view={view} />
        <LastWord chat={map.chat} view={view} />
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
            Then go deeper
          </div>
          {dives.length === 0 && <div className="text-sm text-faint">…</div>}
          {dives.map((d, i) => {
            // skipped from its panel: greyed out here, Restore is in the panel
            const skipped = !!d.dropped || d.status === "dropped";
            return (
              <button
                key={d.id}
                onClick={() => setSelection(open?.id === d.id ? [] : [d.id])}
                title={skipped ? "Skipped: open it to restore it" : undefined}
                className={`mb-1 flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-panel ${open?.id === d.id ? "bg-panel ring-1 ring-primary-line" : ""}`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${d.status === "answered" ? "bg-success text-on-primary" : "ring-1 ring-line-strong text-muted"}`}
                >
                  {skipped ? "–" : d.status === "answered" ? "✓" : i + 1}
                </span>
                <span
                  className={
                    skipped
                      ? "text-faint line-through"
                      : d.status === "answered"
                        ? "text-muted"
                        : "text-ink"
                  }
                >
                  {d.title}
                  {d.status === "answered" && d.summary && (
                    <span className="block text-[11.5px] text-muted">
                      {d.summary}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="relative min-w-0 flex-1">
        <div
          className="h-full transition-[padding]"
          // on a narrow window the review floats over the canvas instead of
          // squeezing it to nothing
          style={{
            paddingRight:
              open && roomy ? 440 : (reviewOpen || ref) && roomy ? 372 : 0,
          }}
        >
          <DesignCanvas
            view={view}
            showReference={!!ref}
            flagged={new Set(hover)}
            picked={picked}
            onPick={(p) => {
              setPicked(p);
              if (p) setSelection([]);
            }}
            act={act}
          />
        </div>

        {/* what is over capacity on the left; checking, the reference and
            the review on the right, clear of a deep dive's panel. When the
            two do not fit side by side, the warning goes under the buttons. */}
        <div
          className="pointer-events-none absolute top-3 z-10 flex flex-wrap-reverse items-end gap-2 [&_button]:pointer-events-auto"
          style={{
            left: ref ? 12 : PALETTE_W + 12,
            right: open && roomy ? 444 : 12,
          }}
        >
          {over.length > 0 && !showReference && (
            <div
              className="pointer-events-auto min-w-0 truncate rounded-lg bg-danger-soft px-3 py-1.5 text-[12.5px] text-danger-strong ring-1 ring-danger-line"
              title={over.map((c) => c.label).join(", ")}
            >
              Over capacity: {over.map((c) => c.label).join(", ")}
            </div>
          )}
          <div className="ml-auto flex shrink-0 flex-col items-end gap-2">
            <div className="flex gap-2">
              {view.reference && (
                <button
                  onClick={() => setShowReference((v) => !v)}
                  className="rounded-lg bg-surface px-3 py-1.5 text-sm text-body shadow-xs ring-1 ring-line-strong hover:ring-primary"
                >
                  {showReference ? "← Your design" : "Reference design"}
                </button>
              )}
              {!view.reference && view.review && (
                <button
                  onClick={() => {
                    // two steps: the reference is the answer, so ask once
                    if (!sure) return setSure(true);
                    void act("reveal").then(() => setShowReference(true));
                  }}
                  onMouseLeave={() => setSure(false)}
                  className={`rounded-lg px-3 py-1.5 text-sm shadow-xs ring-1 ${sure ? "bg-warning-soft text-warning-strong ring-warning-line" : "bg-surface text-muted ring-line hover:text-ink"}`}
                >
                  {sure ? "It's the answer: show it?" : "Show reference"}
                </button>
              )}
              <button
                disabled={live.busy || checking || !view.comps.length}
                onClick={() => {
                  if (checking) return;
                  setChecking(true);
                  setShowReference(false);
                  void act("check").finally(() => setChecking(false));
                }}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary shadow-xs hover:bg-primary-strong disabled:opacity-40"
              >
                {reviewing || checking ? "Reviewing…" : "Check my design"}
              </button>
            </div>
            {view.review && !showReference && !reviewOpen && (
              <button
                onClick={() => setFolded(null)}
                className="rounded-lg bg-surface px-3 py-1.5 text-[12.5px] text-body shadow-xs ring-1 ring-line hover:ring-primary"
              >
                Claude's review ▾
              </button>
            )}
            {checkStopped && !showReference && (
              <div className="pointer-events-auto max-w-[300px] rounded-lg bg-warning-soft px-3 py-1.5 text-[12.5px] text-warning-strong ring-1 ring-warning-line">
                Your last check was stopped before Claude finished
                {view.review ? ": the review is the one before it" : ""}. Check
                again for a new one.
              </div>
            )}
          </div>
        </div>

        {reviewOpen && view.review && (
          <div className="absolute top-14 right-3 bottom-24 z-10 w-[356px]">
            <ReviewCard
              points={view.review.points.map((p) => ({
                ...p,
                text: named(p.text, view.comps),
              }))}
              summary={named(view.review.summary, view.comps)}
              onHover={setHover}
              onFold={() => setFolded(view.review!.at)}
            />
          </div>
        )}

        {ref && ref.notes.length > 0 && (
          <div className="absolute top-14 right-3 bottom-24 z-10 w-[356px]">
            <ReferenceNotes reference={ref} />
          </div>
        )}

        {undo && (
          <div className="absolute bottom-24 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-surface px-3 py-1.5 text-[12.5px] text-body shadow-md ring-1 ring-line">
            <span className="max-w-[280px] truncate">Removed {undo.what}</span>
            <button
              onClick={() => void act("undo")}
              className="font-medium text-primary-strong hover:underline"
            >
              Undo
            </button>
          </div>
        )}

        {picked && !showReference && (
          <Inspector
            view={view}
            picked={picked}
            act={act}
            onClose={() => setPicked(null)}
          />
        )}

        <div onClick={(e) => e.stopPropagation()}>
          {open && (
            <NodePanel
              map={map}
              node={open}
              busy={live.busy}
              working={live.working}
              waiting={live.waiting}
              stream={live.stream}
              settings={ws.settings}
              onSettings={ws.onSettings}
              run={ws.run}
              onSelect={(id) => setSelection([id])}
              onClose={() => setSelection([])}
              asSteps
            />
          )}
          {!open && (
            <FloatingComposer
              ws={ws}
              // clear of the palette, so its last parts can still be clicked
              left={ref ? 0 : PALETTE_W}
              placeholder={
                roomy
                  ? "Ask about your design, or say what you are unsure of…"
                  : "Ask about your design…"
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Brief({ view }: { view: DesignView }) {
  const b = view.brief;
  if (!b)
    return (
      <div className="px-4 py-3 text-sm text-faint">Writing the brief…</div>
    );
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-semibold tracking-wide text-faint uppercase">
        The brief
      </div>
      <div className="mt-0.5 font-serif text-xl text-ink">{b.title}</div>
      <div className="mt-2 flex gap-2">
        <Stat
          label="reads / s at peak"
          value={fmt(b.reads)}
          note={b.readIs && `a read: ${b.readIs}`}
        />
        <Stat
          label="writes / s at peak"
          value={fmt(b.writes)}
          note={b.writeIs && `a write: ${b.writeIs}`}
        />
      </div>
      {b.scale.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          {b.scale.map((x) => (
            <div key={x.label}>
              <div className="text-faint">{x.label}</div>
              <div className="font-medium text-ink">{x.value}</div>
            </div>
          ))}
        </div>
      )}
      <List title="It must" items={b.goals} />
      <List title="Constraints" items={b.constraints} />
      <div className="mt-3 rounded-lg bg-panel px-3 py-2 text-[12px] text-body">
        Build the design on the canvas: drag parts from the palette, wire them
        by dragging between their dots. The bars show a rough load check as you
        go.
      </div>
    </div>
  );
}

const Stat = ({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  // what one of them is, e.g. "a read: a message delivered to one phone"
  note?: string;
}) => (
  <div className="flex-1 rounded-lg bg-panel px-2.5 py-1.5">
    <div className="text-lg font-semibold text-ink tabular-nums">{value}</div>
    <div className="text-[10.5px] text-muted">{label}</div>
    {note && (
      <div className="mt-0.5 text-[10.5px] leading-snug text-body">{note}</div>
    )}
  </div>
);

const List = ({ title, items }: { title: string; items: string[] }) =>
  items.length ? (
    <div className="mt-3">
      <div className="text-[11px] font-semibold text-muted">{title}</div>
      <ul className="mt-0.5 list-disc pl-4 text-[13px] text-body">
        {items.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
    </div>
  ) : null;

// Older maps have no tag on a reply about one node: what was asked tells
const ABOUT_A_NODE = /^(Hint|Go deeper|Challenge): |^Next$/;

// The design's next step, kept on screen: the first thing to build, or the
// last review's next step. Below it, the answer to what you last asked in the
// box, when that came after. Hints and a deep dive's replies stay with it.
function LastWord({ chat, view }: { chat: ChatLine[]; view: DesignView }) {
  let next = -1;
  let asked: { q: string; i: number } | null = null;
  for (let i = chat.length - 1; i >= 0 && next < 0; i--) {
    const c = chat[i];
    if (c.role !== "claude" || c.nodeId || c.blankId) continue;
    // what it answers: skip notes like "Stopped."; the first line is the title
    let j = i - 1;
    while (j > 0 && chat[j].role === "system") j--;
    const q = j > 0 && chat[j].role === "you" ? chat[j].text : "";
    if (ABOUT_A_NODE.test(q)) continue;
    if (!q || q === CHECK) next = i;
    else asked ??= { q, i };
  }
  const block = (title: string, text: string, q?: string) => (
    <div className="border-t border-line px-4 py-3">
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
        {title}
      </div>
      {q && <div className="mb-1.5 text-[12.5px] text-muted italic">{q}</div>}
      <div className="answer answer-sm max-h-60 overflow-y-auto text-[13px]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {named(text, view.comps)}
        </ReactMarkdown>
      </div>
    </div>
  );
  return (
    <>
      {next >= 0 && block("Next step", chat[next].text)}
      {asked &&
        asked.i > next &&
        block("You asked", chat[asked.i].text, asked.q)}
    </>
  );
}

function ReferenceNotes({ reference }: { reference: Reference }) {
  return (
    <div className="max-h-full w-full overflow-y-auto rounded-xl bg-surface p-3 shadow-md ring-1 ring-line">
      <div className="text-[11px] font-semibold tracking-wide text-faint uppercase">
        Why the reference is built this way
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-body">
        {reference.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

const LEVEL: Record<ReviewPoint["level"], { mark: string; tone: string }> = {
  good: { mark: "✓", tone: "text-success-strong" },
  fix: { mark: "!", tone: "text-danger-strong" },
  think: { mark: "?", tone: "text-hint-strong" },
};

function ReviewCard({
  summary,
  points,
  onHover,
  onFold,
}: {
  summary: string;
  points: ReviewPoint[];
  onHover: (ids: string[]) => void;
  onFold: () => void;
}) {
  return (
    <div className="max-h-full w-full overflow-y-auto rounded-xl bg-surface p-3 shadow-md ring-1 ring-line">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold tracking-wide text-faint uppercase">
          Claude's review
        </div>
        <button
          onClick={onFold}
          className="text-[12px] text-muted hover:text-ink"
          title="Fold the review away"
        >
          ▴ Fold
        </button>
      </div>
      {summary && (
        <div className="mt-1 text-[13.5px] font-medium text-ink">{summary}</div>
      )}
      <ul className="mt-2 space-y-1.5">
        {points.map((p, i) => (
          <li
            key={i}
            onMouseEnter={() => onHover(p.on)}
            onMouseLeave={() => onHover([])}
            className="flex gap-2 rounded-md px-1 py-0.5 text-[13px] text-body hover:bg-panel"
          >
            <span className={`w-3 shrink-0 font-bold ${LEVEL[p.level].tone}`}>
              {LEVEL[p.level].mark}
            </span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// the selected component or wire: scale it, rename it, or say what a wire carries
function Inspector({
  view,
  picked,
  act,
  onClose,
}: {
  view: DesignView;
  picked: NonNullable<Picked>;
  act: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
}) {
  const box =
    "absolute z-20 w-[300px] rounded-xl bg-surface p-3 shadow-lg ring-1 ring-line";
  const beside = useBeside(view, picked);
  if (picked.type === "wire") {
    const w = view.wires.find((x) => x.id === picked.id);
    if (!w) return null;
    const from = view.comps.find((c) => c.id === w.from)?.label;
    const to = view.comps.find((c) => c.id === w.to)?.label;
    return (
      <div className={box} style={beside}>
        <Head title={`${from} → ${to}`} onClose={onClose} />
        <div className="mt-2 text-[12px] text-muted">Carries</div>
        <div className="mt-1 flex rounded-lg bg-panel p-0.5 text-[12.5px]">
          {(["both", "read", "write"] as const).map((c) => (
            <button
              key={c}
              onClick={() => void act("wire", { id: w.id, carries: c })}
              className={`flex-1 rounded-md px-2 py-1 ${w.carries === c ? "bg-surface text-ink shadow-xs" : "text-muted"}`}
            >
              {c === "both"
                ? "Reads + writes"
                : c === "read"
                  ? "Reads"
                  : "Writes"}
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center justify-between text-[12.5px] text-body">
          <span title="Each request turns into this many calls, e.g. one per follower">
            Fan-out ×
          </span>
          <NumberField
            value={w.times}
            onCommit={(n) => act("wire", { id: w.id, times: n })}
          />
        </label>
        <button
          onClick={() => {
            void act("unwire", { id: w.id });
            onClose();
          }}
          className="mt-3 text-[12px] text-danger-strong hover:underline"
        >
          Remove this wire
        </button>
      </div>
    );
  }
  const c = view.comps.find((x) => x.id === picked.id);
  if (!c) return null;
  const k = KINDS[c.kind];
  const l = view.load[c.id];
  const st = STATUS_TONE[l?.status ?? "idle"];
  return (
    <div className={box} style={beside}>
      <Head title={k.label} onClose={onClose} />
      <input
        // shows what was saved once it is (the server trims and caps names)
        key={`${c.id}:${c.label}`}
        defaultValue={c.label}
        maxLength={40}
        onBlur={(e) => {
          const name = e.target.value.trim();
          // a part keeps a name: an empty one puts the old one back
          if (!name) e.target.value = c.label;
          else if (name !== c.label)
            void act("update", { id: c.id, label: name });
        }}
        onKeyDown={(e) =>
          e.key === "Enter" && (e.target as HTMLInputElement).blur()
        }
        className="mt-2 w-full rounded-md border border-line-strong px-2 py-1 text-[13px] text-ink outline-hidden focus:border-primary"
      />
      <div className="mt-1 text-[11.5px] text-muted">{k.hint}</div>
      <label className="mt-2 flex items-center justify-between text-[12.5px] text-body">
        {k.store ? "Replicas" : "Instances"}
        <NumberField
          value={c.count}
          onCommit={(n) => act("update", { id: c.id, count: n })}
        />
      </label>
      {k.shards && (
        <label className="mt-1.5 flex items-center justify-between text-[12.5px] text-body">
          Shards
          <NumberField
            value={c.shards}
            onCommit={(n) => act("update", { id: c.id, shards: n })}
          />
        </label>
      )}
      {l && (
        // reads and writes share one capacity, so it is shown once, with
        // what the two together use of it
        <div className="mt-2 rounded-lg bg-panel px-2.5 py-1.5 text-[12px] tabular-nums">
          <div className="flex justify-between">
            <span className="text-muted">Reads</span>
            <span>{fmt(l.reads)} per s</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Writes</span>
            <span>{fmt(l.writes)} per s</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted">Can take</span>
            <span className="text-right">
              {!Number.isFinite(l.capRead)
                ? "no limit here"
                : l.capRead === l.capWrite
                  ? `${fmt(l.capRead)} requests per s`
                  : `${fmt(l.capRead)} reads or ${fmt(l.capWrite)} writes per s`}
            </span>
          </div>
          <div className={`mt-0.5 font-medium ${st.text}`}>
            {Number.isFinite(l.capRead) && l.reads + l.writes > 0
              ? `${l.util > 1 ? `${+l.util.toFixed(1)}× its capacity` : `${Math.round(l.util * 100)}% of capacity`} · `
              : ""}
            {st.label}
            {l.async && " · behind a queue"}
          </div>
        </div>
      )}
      <div className="mt-1 text-[10.5px] text-faint">
        Rough rules of thumb, not a benchmark.
      </div>
      <button
        onClick={() => {
          void act("remove", { id: c.id });
          onClose();
        }}
        className="mt-2 text-[12px] text-danger-strong hover:underline"
      >
        Remove
      </button>
    </div>
  );
}

// The inspector opens beside what you picked (right of it, or left when there
// is no room), inside the canvas, and follows it when the canvas moves.
const PANEL_W = 300;
function useBeside(view: DesignView, picked: NonNullable<Picked>) {
  const { x, y, zoom } = useViewport();
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);
  const comp = (id: string) => view.comps.find((c) => c.id === id);
  let at: { x: number; y: number; w: number } | null = null;
  if (picked.type === "comp") {
    const c = comp(picked.id);
    if (c) at = { x: c.x, y: c.y, w: NODE_W };
  } else {
    const w = view.wires.find((o) => o.id === picked.id);
    const a = w && comp(w.from);
    const b = w && comp(w.to);
    if (a && b)
      at = { x: (a.x + b.x + NODE_W) / 2, y: (a.y + b.y) / 2 + 30, w: 0 };
  }
  if (!at) return { left: PALETTE_W + 16, top: 12 };
  const left = PALETTE_W + at.x * zoom + x;
  const right = left + at.w * zoom;
  const maxLeft = PALETTE_W + paneW - PANEL_W - 8;
  return {
    left: Math.round(
      right + 12 <= maxLeft
        ? right + 12
        : Math.max(PALETTE_W + 8, Math.min(maxLeft, left - PANEL_W - 12)),
    ),
    top: Math.round(Math.max(56, Math.min(at.y * zoom + y, paneH - 340))),
  };
}

const Head = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <div className="flex items-center justify-between gap-2">
    <div
      className="min-w-0 truncate text-[13px] font-semibold text-ink"
      title={title}
    >
      {title}
    </div>
    <button onClick={onClose} className="shrink-0 text-muted hover:text-ink">
      ×
    </button>
  </div>
);

// A count you can type or step. It shows what you typed or stepped to while
// that is on its way, then what was saved (the server keeps 1 to 10,000: a brief at chat-app scale needs over 1,000 instances), so
// quick clicks add up and a typed number is what − and + start from.
function NumberField({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => Promise<unknown>;
}) {
  const [text, setText] = useState(String(value));
  const [synced, setSynced] = useState(value);
  const [sending, setSending] = useState(0);
  if (sending === 0 && value !== synced) {
    setSynced(value);
    setText(String(value));
  }
  const typed = Math.round(Number(text));
  const current = Number.isFinite(typed) && typed >= 1 ? typed : value;
  const send = (n: number) => {
    setText(String(n));
    if (n === value && sending === 0) return;
    setSending((k) => k + 1);
    void onCommit(n).finally(() => {
      setSending((k) => k - 1);
      // look at the saved value again once nothing is on its way
      setSynced(Number.NaN);
    });
  };
  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => send(Math.max(1, current - 1))}
        className="h-6 w-6 rounded-md bg-panel text-body hover:bg-line"
      >
        −
      </button>
      <input
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          // anything that is not a count of at least 1 snaps back
          if (String(current) === text.trim()) send(current);
          else setText(String(value));
        }}
        onKeyDown={(e) =>
          e.key === "Enter" && (e.target as HTMLInputElement).blur()
        }
        className="w-14 rounded-md border border-line-strong px-1.5 py-0.5 text-center text-[13px] tabular-nums outline-hidden focus:border-primary"
      />
      <button
        onClick={() => send(current + 1)}
        className="h-6 w-6 rounded-md bg-panel text-body hover:bg-line"
      >
        +
      </button>
    </span>
  );
}
