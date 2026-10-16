import dagre from "@dagrejs/dagre";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Diagram, Fill, Link } from "../../shared/model.ts";

type Blank = { id: string; blank?: boolean; prompt?: string; filled?: boolean };
type Ctx = {
  fills: Record<string, Fill>;
  busy: boolean;
  onFill: (id: string, text: string) => void;
  // what Claude said about each blank's latest answer, by blank id
  verdict: (id: string) => string;
  // where to go once every blank is filled
  next?: { title: string; go: () => void } | null;
  onOpen: (id: string, label: string) => void; // a part was clicked: explain it, go deeper, talk about it
  openId: string | null;
};

// Any labelled part of the diagram: click it to have it explained and to talk about it.
function Part({
  ctx,
  id,
  label,
  children,
  className = "",
}: {
  ctx: Ctx;
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const on = ctx.openId === id;
  return (
    <div
      role="button"
      tabIndex={0}
      title="Click to explain this, go deeper, or ask about it"
      onClick={(e) => {
        e.stopPropagation();
        ctx.onOpen(id, label);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          ctx.onOpen(id, label);
        }
      }}
      className={`cursor-pointer rounded-lg transition hover:ring-2 hover:ring-primary/60 ${on ? "ring-2 ring-primary" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

// Shrinks a wide drawing to the space it has (never below 55%; past that, scroll).
function Fit({ width, children }: { width: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const [h, setH] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setRoom(box.current?.clientWidth ?? 0);
      setH(inner.current?.offsetHeight ?? 0);
    });
    if (box.current) ro.observe(box.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);
  const k = room ? Math.max(0.55, Math.min(1, room / width)) : 1;
  return (
    <div ref={box} className="w-full">
      <div
        style={{ width: width * k, height: h ? h * k : undefined }}
        className="mx-auto"
      >
        <div
          ref={inner}
          className="origin-top-left"
          style={{ width, transform: k < 1 ? `scale(${k})` : undefined }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// A part of the diagram the learner fills: type on the diagram, Enter, Claude checks.
function BlankBox({
  el,
  ctx,
  className = "",
}: {
  el: Blank;
  ctx: Ctx;
  className?: string;
}) {
  const fill = ctx.fills[el.id];
  const [text, setText] = useState(fill?.text ?? "");
  // what the server last recorded for this blank replaces what is typed
  const [seenFill, setSeenFill] = useState(fill?.text);
  if (fill?.text !== seenFill) {
    setSeenFill(fill?.text);
    if (fill?.text) setText(fill.text);
  }
  const pending = fill?.state === "pending";
  const wrong = fill?.state === "wrong";
  return (
    <div
      className={`rounded-lg border-2 border-dashed px-2 py-1.5 text-left ${wrong ? "border-danger bg-danger-soft" : "border-primary bg-primary-soft/70"} ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={`text-[10.5px] font-semibold leading-tight ${wrong ? "text-danger-strong" : "text-primary-strong"}`}
      >
        {wrong ? "Not quite. " : ""}
        {el.prompt || "Fill this in"}
      </div>
      <input
        value={text}
        disabled={pending}
        placeholder={pending ? "checking…" : "type, then Enter"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) ctx.onFill(el.id, text.trim());
        }}
        className="mt-1 w-full rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-[13px] text-ink outline-hidden focus:border-primary disabled:bg-panel"
      />
      {pending && (
        <div className="mt-0.5 animate-pulse text-[10.5px] text-muted">
          Claude is checking…
        </div>
      )}
      {wrong && ctx.verdict(el.id) && (
        <div className="mt-1 text-[11.5px] leading-snug text-danger-strong">
          {ctx.verdict(el.id)}
        </div>
      )}
    </div>
  );
}

const Got = ({ el }: { el: Blank }) =>
  el.filled ? (
    <span
      className="ml-1 text-[10px] font-semibold text-success-strong"
      title="Filled in"
    >
      ✓
    </span>
  ) : null;

// ---- sequence: lanes across, messages down ----------------------------------------
// Rows sit in normal flow so a blank with feedback grows its row instead of
// covering the one above; the arrow is drawn at each row's foot.
function Sequence({
  d,
  ctx,
}: {
  d: Extract<Diagram, { form: "sequence" }>;
  ctx: Ctx;
}) {
  const lanes = d.lanes.length ? d.lanes : ["A", "B"];
  const GAP = lanes.length === 2 ? 400 : lanes.length === 3 ? 310 : 240,
    PAD = 80;
  const W = PAD * 2 + GAP * (lanes.length - 1);
  const x = (name: string) =>
    PAD +
    GAP *
      Math.max(
        0,
        lanes.findIndex((l) => l.toLowerCase() === name.toLowerCase()),
      );
  return (
    <Fit width={W}>
      <div style={{ width: W }} className="relative">
        {lanes.map((l) => (
          <div
            key={l}
            style={{ left: x(l) }}
            className="absolute bottom-0 top-14 border-l-2 border-dashed border-line-strong"
          />
        ))}
        <div className="relative h-16">
          {lanes.map((l) => (
            <div
              key={l}
              style={{ left: x(l) - 80, width: 160 }}
              className="absolute top-0"
            >
              <Part ctx={ctx} id={`lane:${l}`} label={l}>
                <div className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-center text-[12.5px] font-semibold leading-tight text-ink shadow-xs">
                  {l}
                </div>
              </Part>
            </div>
          ))}
        </div>
        {d.steps.map((s, i) => {
          const a = x(s.from),
            b = x(s.to);
          const self = a === b;
          const left = self ? a + 40 : Math.min(a, b) + 10;
          const width = self ? 230 : Math.max(Math.abs(b - a) - 20, 60);
          return (
            <div key={s.id ?? i} className="relative pb-6 pt-3">
              <div className="absolute bottom-[15px] left-1 text-[10px] text-faint">
                {i + 1}
              </div>
              <div
                style={{ marginLeft: left, width }}
                className="flex justify-center"
              >
                {s.blank ? (
                  <BlankBox el={s} ctx={ctx} className="w-full max-w-[260px]" />
                ) : (
                  <Part ctx={ctx} id={s.id} label={s.label}>
                    <span
                      className={`block rounded-sm px-1.5 text-center text-[13.5px] leading-tight ${s.filled ? "bg-success-soft font-medium text-success-strong" : "bg-canvas text-ink"}`}
                    >
                      {s.label}
                      <Got el={s} />
                    </span>
                  </Part>
                )}
              </div>
              {self ? (
                <div
                  style={{ left: a + 4, width: 28, height: 22 }}
                  className="absolute bottom-2 rounded-r-md border-2 border-l-0 border-ink"
                />
              ) : (
                <div
                  style={{ left: Math.min(a, b), width: Math.abs(b - a) }}
                  className={`absolute bottom-[18px] border-t-2 ${s.blank ? "border-dashed border-primary" : s.filled ? "border-success" : "border-ink"}`}
                >
                  <span
                    className={`absolute top-[-7px] h-0 w-0 border-y-[6px] border-y-transparent ${b > a ? "right-[-2px] border-l-[9px] border-l-ink" : "left-[-2px] border-r-[9px] border-r-ink"}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Fit>
  );
}

// ---- concept and structure: boxes and labelled arrows, laid out by dagre ------------
type GNode = {
  id: string;
  label: string;
  w: number;
  h: number;
  body: ReactNode;
};
function Graph({ nodes, links }: { nodes: GNode[]; links: Link[] }) {
  const laid = useMemo(() => {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({
      rankdir: "LR",
      nodesep: 34,
      ranksep: 110,
      marginx: 16,
      marginy: 16,
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h });
    // links may name a node by id or by its label
    const find = (ref: string) =>
      nodes.find((n) => n.id === ref)?.id ??
      nodes.find((n) => n.label && n.label.toLowerCase() === ref.toLowerCase())
        ?.id;
    links.forEach((l, i) => {
      const a = find(l.from),
        b = find(l.to);
      if (a && b && a !== b)
        g.setEdge(
          a,
          b,
          {
            label: l.label,
            width: Math.min(160, l.label.length * 6.6 + 14),
            height: 20,
            labelpos: "c",
          },
          `e${i}`,
        );
    });
    dagre.layout(g);
    const edges = g.edges().map((e) => ({
      key: e.name ?? `${e.v}-${e.w}`,
      ...(g.edge(e) as {
        points: { x: number; y: number }[];
        x: number;
        y: number;
        label: string;
      }),
    }));
    return {
      g: g.graph() as { width: number; height: number },
      pos: Object.fromEntries(nodes.map((n) => [n.id, g.node(n.id)])),
      edges,
    };
  }, [nodes, links]);
  // shrink a wide graph to fit the space (never below 60%; past that, scroll)
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = room ? Math.max(0.6, Math.min(1, room / laid.g.width)) : 1;
  return (
    <div ref={box} className="w-full">
      <div
        style={{ width: laid.g.width * k, height: laid.g.height * k }}
        className="mx-auto"
      >
        <div
          className="relative origin-top-left"
          style={{
            width: laid.g.width,
            height: laid.g.height,
            transform: k < 1 ? `scale(${k})` : undefined,
          }}
        >
          <svg
            className="absolute inset-0 overflow-visible"
            width={laid.g.width}
            height={laid.g.height}
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path
                  d="M0,0 L10,5 L0,10 z"
                  style={{ fill: "var(--color-muted)" }}
                />
              </marker>
            </defs>
            {laid.edges.map((e) => (
              <path
                key={e.key}
                d={`M${e.points.map((p) => `${p.x},${p.y}`).join(" L")}`}
                fill="none"
                style={{ stroke: "var(--color-faint)" }}
                strokeWidth={1.6}
                markerEnd="url(#arrow)"
              />
            ))}
          </svg>
          {laid.edges.map(
            (e) =>
              e.label && (
                <div
                  key={`l${e.key}`}
                  style={{ left: e.x, top: e.y }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm bg-canvas px-1 text-[11.5px] italic text-muted"
                >
                  {e.label}
                </div>
              ),
          )}
          {nodes.map((n) => {
            const p = laid.pos[n.id];
            return (
              p && (
                <div
                  key={n.id}
                  style={{
                    left: p.x - n.w / 2,
                    top: p.y - n.h / 2,
                    width: n.w,
                    minHeight: n.h,
                  }}
                  className="absolute"
                >
                  {n.body}
                </div>
              )
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Concept({
  d,
  ctx,
}: {
  d: Extract<Diagram, { form: "concept" }>;
  ctx: Ctx;
}) {
  const nodes: GNode[] = d.nodes.map((n) =>
    n.blank
      ? {
          id: n.id,
          label: "",
          w: 210,
          h: 84,
          body: <BlankBox el={n} ctx={ctx} />,
        }
      : {
          id: n.id,
          label: n.label,
          w: 190,
          h: n.note ? 64 : 42,
          body: (
            <Part ctx={ctx} id={n.id} label={n.label} className="rounded-xl">
              <div
                className={`rounded-xl border px-3 py-2 text-center shadow-xs ${n.filled ? "border-success bg-success-soft" : "border-line-strong bg-surface"}`}
              >
                <div className="text-[13.5px] font-semibold leading-tight text-ink">
                  {n.label}
                  <Got el={n} />
                </div>
                {n.note && (
                  <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                    {n.note}
                  </div>
                )}
              </div>
            </Part>
          ),
        },
  );
  return <Graph nodes={nodes} links={d.links} />;
}

function Structure({
  d,
  ctx,
}: {
  d: Extract<Diagram, { form: "structure" }>;
  ctx: Ctx;
}) {
  const nodes: GNode[] = d.boxes.map((b) =>
    b.blank
      ? {
          id: b.id,
          label: "",
          w: 210,
          h: 84,
          body: <BlankBox el={b} ctx={ctx} />,
        }
      : {
          id: b.id,
          label: b.label,
          w: 200,
          h: 34 + (b.rows?.length ?? 0) * 21,
          body: (
            <Part ctx={ctx} id={b.id} label={b.label}>
              <div
                className={`overflow-hidden rounded-lg border-2 shadow-xs ${b.filled ? "border-success bg-success-soft" : "border-ink/70 bg-surface"}`}
              >
                <div className="bg-panel px-2 py-1 text-[12.5px] font-semibold text-ink">
                  {b.label}
                  <Got el={b} />
                </div>
                {b.rows?.map((r, i) => (
                  <div
                    key={i}
                    className="border-t border-line px-2 py-0.5 font-mono text-[11.5px] text-body"
                  >
                    {r}
                  </div>
                ))}
              </div>
            </Part>
          ),
        },
  );
  return <Graph nodes={nodes} links={d.arrows} />;
}

// ---- timeline: events either side of one axis --------------------------------------
function Timeline({
  d,
  ctx,
}: {
  d: Extract<Diagram, { form: "timeline" }>;
  ctx: Ctx;
}) {
  return (
    <div className="relative mx-auto max-w-3xl py-2">
      <div className="absolute bottom-0 left-1/2 top-0 w-0.5 -translate-x-1/2 bg-line-strong" />
      {d.events.map((e, i) => {
        const card = e.blank ? (
          <BlankBox el={e} ctx={ctx} className="w-full max-w-[260px]" />
        ) : (
          <Part
            ctx={ctx}
            id={e.id}
            label={`${e.when}: ${e.label}`}
            className="inline-block"
          >
            <div
              className={`max-w-[300px] rounded-lg border px-3 py-1.5 text-left shadow-xs ${e.filled ? "border-success bg-success-soft" : "border-line-strong bg-surface"}`}
            >
              <div className="text-[13.5px] font-semibold leading-snug text-ink">
                {e.label}
                <Got el={e} />
              </div>
              {e.note && (
                <div className="text-[12px] leading-snug text-muted">
                  {e.note}
                </div>
              )}
            </div>
          </Part>
        );
        return (
          <div
            key={e.id ?? i}
            className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2"
          >
            <div className="flex justify-end">{i % 2 === 0 && card}</div>
            <div className="z-10 whitespace-nowrap rounded-full bg-ink px-2.5 py-0.5 font-mono text-[11.5px] text-on-primary">
              {e.when || "?"}
            </div>
            <div className="flex justify-start">{i % 2 === 1 && card}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---- grid: alternatives against criteria ---------------------------------------
function Grid({ d, ctx }: { d: Extract<Diagram, { form: "grid" }>; ctx: Ctx }) {
  return (
    <table className="mx-auto border-separate border-spacing-0 overflow-hidden rounded-xl bg-surface text-[13.5px] shadow-xs ring-1 ring-line">
      <thead>
        <tr>
          <th className="bg-panel" />
          {d.columns.map((c) => (
            <th
              key={c}
              className="bg-panel px-2 py-1.5 text-left font-semibold text-ink"
            >
              <Part ctx={ctx} id={`col:${c}`} label={c} className="px-2 py-0.5">
                {c}
              </Part>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {d.rows.map((r, i) => (
          <tr key={i}>
            <th className="border-t border-line bg-panel px-2 py-1.5 text-left font-medium text-body">
              <Part
                ctx={ctx}
                id={`row:${r.label}`}
                label={r.label}
                className="px-2 py-0.5"
              >
                {r.label}
              </Part>
            </th>
            {r.cells.map((c, j) => (
              <td
                key={c.id ?? j}
                className={`min-w-[150px] border-t border-line px-3 py-2 align-top ${c.filled ? "bg-success-soft" : ""}`}
              >
                {c.blank ? (
                  <BlankBox el={c} ctx={ctx} />
                ) : (
                  <Part
                    ctx={ctx}
                    id={c.id}
                    label={`${r.label}, ${d.columns[j] ?? ""}: ${c.text}`}
                    className="-mx-1 px-1"
                  >
                    {c.text}
                    <Got el={c} />
                  </Part>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const NAMES = {
  sequence: "Sequence",
  concept: "Concept map",
  timeline: "Timeline",
  structure: "Structure",
  grid: "Comparison grid",
};

function blanksOf(d: Diagram): Blank[] {
  switch (d.form) {
    case "sequence":
      return d.steps;
    case "concept":
      return d.nodes;
    case "timeline":
      return d.events;
    case "structure":
      return d.boxes;
    case "grid":
      return d.rows.flatMap((r) => r.cells);
  }
}

// The topic itself, in the form that fits it, with the parts you work out left blank.
export function DiagramView({
  diagram,
  ...ctx
}: { diagram: Diagram | null } & Ctx) {
  if (!diagram)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        {ctx.busy ? (
          <div className="w-[520px] max-w-[80%]">
            <div className="skeleton mx-auto mb-6 h-5 w-1/2" />
            <div className="grid grid-cols-3 items-center gap-8">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`skeleton h-12 ${i % 2 ? "opacity-60" : ""}`}
                />
              ))}
            </div>
            <div className="mt-6 text-center text-sm">
              Claude is drawing the topic…
            </div>
          </div>
        ) : (
          "No diagram yet. Press Next step."
        )}
      </div>
    );
  const all = blanksOf(diagram);
  const open = all.filter((b) => b.blank).length;
  const done = all.filter((b) => b.filled).length;
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1400px] px-8 pb-40 pt-6">
        <div className="mb-5 flex items-baseline justify-center gap-3 text-center">
          <h2 className="font-serif text-2xl text-ink">{diagram.title}</h2>
          <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted ring-1 ring-line">
            {NAMES[diagram.form]}
          </span>
        </div>
        <div className="-mt-3 mb-5 text-center text-xs text-muted">
          Click any part to have it explained or to ask about it
          {open > 0 && (
            <>
              {" "}
              · {open} dashed part{open > 1 ? "s" : ""} for you to fill
            </>
          )}
          {done > 0 && (
            <span className="text-success-strong"> · {done} filled ✓</span>
          )}
        </div>
        {open === 0 && done > 0 && (
          <div className="mx-auto -mt-1 mb-5 flex max-w-xl flex-wrap items-center justify-center gap-3 rounded-xl bg-success-soft px-4 py-3 text-center ring-1 ring-success-line">
            <span className="text-[14px] font-medium text-success-strong">
              ✓ You filled every part of the diagram.
            </span>
            {ctx.next && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.next?.go();
                }}
                className="rounded-full bg-primary px-3.5 py-1 text-[13px] font-medium text-on-primary hover:bg-primary-strong"
              >
                Next: {ctx.next.title} ▸
              </button>
            )}
          </div>
        )}
        {diagram.form === "sequence" && <Sequence d={diagram} ctx={ctx} />}
        {diagram.form === "concept" && <Concept d={diagram} ctx={ctx} />}
        {diagram.form === "structure" && <Structure d={diagram} ctx={ctx} />}
        {diagram.form === "timeline" && <Timeline d={diagram} ctx={ctx} />}
        {diagram.form === "grid" && <Grid d={diagram} ctx={ctx} />}
      </div>
    </div>
  );
}
