import { ReactFlowProvider } from "@xyflow/react";
import { useState } from "react";

import { DesignCanvas, type Picked } from "./DesignCanvas.tsx";
import { fmt, STATUS_TONE } from "./format.ts";
import { FloatingComposer } from "../../../web/components/FloatingComposer.tsx";
import { NodePanel } from "../../../web/components/NodePanel.tsx";
import type { Workspace } from "../../../web/lib/workspace.ts";
import {
  KINDS,
  PLUGIN_ID,
  type DesignView,
  type ReviewPoint,
} from "../shared.ts";

const REVIEWING = "Reviewing your design";

// Design: the brief and the deep dives on the left; the canvas you build on in
// the middle, with the palette; Claude's review and the selected part on top.
export function DesignScreen({ ws }: { ws: Workspace }) {
  const { map, live, selection, setSelection, roomy } = ws;
  const view = (map.data?.[PLUGIN_ID] ?? null) as DesignView | null;
  const [picked, setPicked] = useState<Picked>(null);
  const [hover, setHover] = useState<string[]>([]);
  const [showReference, setShowReference] = useState(false);
  const [sure, setSure] = useState(false);
  // a new review opens; you can fold it away until the next one
  const [folded, setFolded] = useState<number | null>(null);
  const open = selection.length === 1 ? map.nodes[selection[0]] : undefined;
  // the review steps aside while a deep dive's panel is open
  const reviewOpen =
    !!view?.review && folded !== view.review.at && !showReference && !open;
  const act = (name: string, args: Record<string, unknown> = {}) =>
    ws.run({ type: "plugin", plugin: PLUGIN_ID, name, args });

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
  return (
    <div className="flex h-full">
      <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
        <Brief view={view} />
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
            Then go deeper
          </div>
          {dives.length === 0 && <div className="text-sm text-faint">…</div>}
          {dives.map((d, i) => (
            <button
              key={d.id}
              onClick={() => setSelection(open?.id === d.id ? [] : [d.id])}
              className={`mb-1 flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-panel ${open?.id === d.id ? "bg-panel ring-1 ring-primary-line" : ""}`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${d.status === "answered" ? "bg-success text-on-primary" : "ring-1 ring-line-strong text-muted"}`}
              >
                {d.status === "answered" ? "✓" : i + 1}
              </span>
              <span
                className={d.status === "answered" ? "text-muted" : "text-ink"}
              >
                {d.title}
                {d.status === "answered" && d.summary && (
                  <span className="block text-[11.5px] text-muted">
                    {d.summary}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="relative min-w-0 flex-1">
        <div
          className="h-full transition-[padding]"
          style={{ paddingRight: open && roomy ? 440 : reviewOpen ? 372 : 0 }}
        >
          <ReactFlowProvider>
            <DesignCanvas
              view={view}
              showReference={showReference && !!view.reference}
              flagged={new Set(hover)}
              picked={picked}
              onPick={(p) => {
                setPicked(p);
                if (p) setSelection([]);
              }}
              act={act}
            />
          </ReactFlowProvider>
        </div>

        {/* what to do next, and the review */}
        <div className="absolute top-3 right-3 z-10 flex w-[340px] flex-col items-end gap-2">
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
              disabled={live.busy || !view.comps.length}
              onClick={() => {
                setShowReference(false);
                void act("check");
              }}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary shadow-xs hover:bg-primary-strong disabled:opacity-40"
            >
              {reviewing ? "Reviewing…" : "Check my design"}
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
        </div>

        {over.length > 0 && !showReference && (
          <div className="absolute top-3 left-[180px] z-10 rounded-lg bg-danger-soft px-3 py-1.5 text-[12.5px] text-danger-strong ring-1 ring-danger-line">
            Over capacity: {over.map((c) => c.label).join(", ")}
          </div>
        )}

        {reviewOpen && view.review && (
          <div className="absolute top-14 right-3 bottom-24 z-10 w-[356px]">
            <ReviewCard
              points={view.review.points}
              summary={view.review.summary}
              onHover={setHover}
              onFold={() => setFolded(view.review!.at)}
            />
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
        <Stat label="reads / s at peak" value={fmt(b.reads)} />
        <Stat label="writes / s at peak" value={fmt(b.writes)} />
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

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex-1 rounded-lg bg-panel px-2.5 py-1.5">
    <div className="text-lg font-semibold text-ink tabular-nums">{value}</div>
    <div className="text-[10.5px] text-muted">{label}</div>
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
    "absolute bottom-24 left-[184px] z-20 w-[300px] rounded-xl bg-surface p-3 shadow-lg ring-1 ring-line";
  if (picked.type === "wire") {
    const w = view.wires.find((x) => x.id === picked.id);
    if (!w) return null;
    const from = view.comps.find((c) => c.id === w.from)?.label;
    const to = view.comps.find((c) => c.id === w.to)?.label;
    return (
      <div className={box}>
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
            onCommit={(n) => void act("wire", { id: w.id, times: n })}
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
    <div className={box}>
      <Head title={k.label} onClose={onClose} />
      <input
        key={c.id}
        defaultValue={c.label}
        onBlur={(e) =>
          e.target.value.trim() !== c.label &&
          void act("update", { id: c.id, label: e.target.value })
        }
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
          onCommit={(n) => void act("update", { id: c.id, count: n })}
        />
      </label>
      {k.shards && (
        <label className="mt-1.5 flex items-center justify-between text-[12.5px] text-body">
          Shards
          <NumberField
            value={c.shards}
            onCommit={(n) => void act("update", { id: c.id, shards: n })}
          />
        </label>
      )}
      {l && (
        <div className="mt-2 rounded-lg bg-panel px-2.5 py-1.5 text-[12px] tabular-nums">
          <div className="flex justify-between">
            <span className="text-muted">Reads</span>
            <span>
              {fmt(l.reads)} / {fmt(l.capRead)} per s
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Writes</span>
            <span>
              {fmt(l.writes)} / {fmt(l.capWrite)} per s
            </span>
          </div>
          <div className={`mt-0.5 font-medium ${st.text}`}>
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

const Head = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <div className="flex items-center justify-between">
    <div className="text-[13px] font-semibold text-ink">{title}</div>
    <button onClick={onClose} className="text-muted hover:text-ink">
      ×
    </button>
  </div>
);

function NumberField({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => onCommit(Math.max(1, value - 1))}
        className="h-6 w-6 rounded-md bg-panel text-body hover:bg-line"
      >
        −
      </button>
      <input
        key={value}
        defaultValue={value}
        inputMode="numeric"
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 1 && n !== value)
            onCommit(Math.round(n));
        }}
        onKeyDown={(e) =>
          e.key === "Enter" && (e.target as HTMLInputElement).blur()
        }
        className="w-14 rounded-md border border-line-strong px-1.5 py-0.5 text-center text-[13px] tabular-nums outline-hidden focus:border-primary"
      />
      <button
        onClick={() => onCommit(value + 1)}
        className="h-6 w-6 rounded-md bg-panel text-body hover:bg-line"
      >
        +
      </button>
    </span>
  );
}
