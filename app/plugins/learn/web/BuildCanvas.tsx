import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import {
  drawn,
  looseZone,
  NODE_H,
  NODE_W,
  regions,
  slotAt,
  spanOf,
  tidy,
  type At,
  type Region,
} from "./frame.ts";
import { MARK, WAIT_TITLE, type Here } from "./view.ts";
import {
  FAMILIES,
  familyOf,
  type Family,
  type LinkView,
  type Mark,
  type StepView,
  type Verb,
} from "../shared.ts";

// a part dragged from the tray onto the canvas
export const PART_DRAG = "application/x-living-map-part";
// the message box covers the bottom of the canvas
const FIT = {
  padding: { top: "40px", bottom: "120px", x: "6%" },
  maxZoom: 1,
} as const;

type Tone = "plain" | "hidden" | "pick" | "chosen" | "found" | "extra";
type PartData = {
  label: string;
  role: string;
  tone: Tone;
  // the part a what-if wipes out
  fails?: boolean;
  // a word on the card from the last check ("not in its lane")
  badge?: string;
  onOut?: () => void;
};
type RegionData = { label: string; loose: boolean; wide: boolean };

const SIDES = ["top", "right", "bottom", "left"] as const;
const hidden = "!h-2 !w-2 !min-w-0 !border-0 !bg-transparent";

function PartNode({ data }: NodeProps<Node<PartData>>) {
  const ring =
    data.tone === "pick"
      ? "ring-2 ring-primary"
      : data.tone === "chosen"
        ? "ring-2 ring-hint bg-hint-soft"
        : data.tone === "found"
          ? "ring-2 ring-success bg-success-soft"
          : data.tone === "extra"
            ? "ring-2 ring-danger bg-danger-soft"
            : data.tone === "hidden"
              ? "border-2 border-dashed border-hint bg-hint-soft"
              : data.fails
                ? "ring-2 ring-danger"
                : "ring-1 ring-line-strong";
  return (
    <div
      className={`relative rounded-xl bg-surface px-2.5 py-1.5 shadow-xs ${ring}`}
      style={{ width: NODE_W, minHeight: NODE_H }}
      title={data.role ? `${data.label}: ${data.role}` : data.label}
    >
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={Position[(side[0].toUpperCase() + side.slice(1)) as "Top"]}
          className={hidden}
          isConnectable={false}
        />
      ))}
      <div
        className={`text-[13px] font-semibold leading-tight ${data.tone === "hidden" ? "text-center text-xl text-hint-strong" : "text-ink"}`}
      >
        {data.label}
      </div>
      {data.role && (
        <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-muted">
          {data.role}
        </div>
      )}
      {data.fails && (
        <div className="mt-0.5 text-[10.5px] font-medium text-danger-strong">
          ✕ wiped out
        </div>
      )}
      {data.badge && (
        <div className="mt-0.5 text-[10.5px] font-medium text-warning-strong">
          {data.badge}
        </div>
      )}
      {data.onOut && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onOut!();
          }}
          title="Back to the tray"
          className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[11px] text-muted shadow-xs ring-1 ring-line-strong hover:text-ink"
        >
          ↩
        </button>
      )}
    </div>
  );
}

function RegionNode({ data }: NodeProps<Node<RegionData>>) {
  return (
    <div
      className={`h-full w-full rounded-xl ${data.loose ? "border border-dashed border-line-strong" : "bg-panel/70 ring-1 ring-line"}`}
    >
      <div
        className={`px-2.5 pt-1.5 text-[10.5px] font-semibold tracking-wide text-muted uppercase ${data.wide ? "max-w-[110px]" : "truncate"}`}
      >
        {data.label}
      </div>
    </div>
  );
}

const nodeTypes = { part: PartNode, region: RegionNode };

const TONE: Record<Mark | "plain" | "given" | "ghost", string> = {
  right: "var(--color-success)",
  reversed: "var(--color-warning)",
  family: "var(--color-warning)",
  miscon: "var(--color-danger)",
  extra: "var(--color-faint)",
  plain: "var(--color-ink)",
  given: "var(--color-line-strong)",
  ghost: "var(--color-hint)",
};

// the sides a link leaves and enters by: across when the parts sit side by
// side, down when one is above the other
function sides(a?: At, b?: At): [string, string] {
  if (!a || !b) return ["right", "left"];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy) * 1.4)
    return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

// whether the straight line between two parts' centres crosses a third part
function through(from: string, to: string, at: Record<string, At>): boolean {
  const a = at[from];
  const b = at[to];
  if (!a || !b) return false;
  for (const [id, p] of Object.entries(at)) {
    if (id === from || id === to) continue;
    for (let k = 1; k < 12; k++) {
      const x = a.x + ((b.x - a.x) * k) / 12 + NODE_W / 2;
      const y = a.y + ((b.y - a.y) * k) / 12 + NODE_H / 2;
      if (x > p.x && x < p.x + NODE_W && y > p.y && y < p.y + NODE_H)
        return true;
    }
  }
  return false;
}

function edgeOf(
  id: string,
  from: string,
  to: string,
  label: string,
  tone: keyof typeof TONE,
  at: Record<string, At>,
  dashed = false,
): Edge {
  const [sourceHandle, targetHandle] = sides(at[from], at[to]);
  const color = TONE[tone];
  // a straight run through another part would read as linked to it: the link
  // steps out round the side instead
  const round = through(from, to, at);
  return {
    sourceHandle,
    targetHandle,
    ...(round && {
      type: "smoothstep",
      pathOptions: { offset: 28 },
      sourceHandle: "right",
      targetHandle: "right",
    }),
    id,
    source: from,
    target: to,
    label,
    style: {
      stroke: color,
      strokeWidth: tone === "given" ? 1.4 : 1.8,
      ...(dashed ? { strokeDasharray: "5 4" } : {}),
    },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    labelStyle: { fontSize: 11, fill: "var(--color-body)" },
    labelBgStyle: { fill: "var(--color-surface)" },
    labelBgPadding: [4, 2],
  };
}

type Pop =
  | { kind: "verb"; from: string; to: string; at: At }
  | { kind: "link"; id: string; at: At }
  | { kind: "part"; id: string; at: At }
  | null;

export type WhatIfMode = {
  picked: string[];
  toggle: (part: string) => void;
  // the result once checked: found and extra part ids
  found: string[];
  extra: string[];
  fails: string;
};

// The canvas a step is built on. `worked`: the worked case, read-only.
// `build`: your build, which you place, move and link (click a part, then
// another, then pick a verb), with the last check's marks. `done`: your
// build once it passed, read-only, where a what-if is clicked and a part
// can be gone into deeper.
export function BuildCanvas({
  here,
  st,
  mode,
  whatif,
  onDeeper,
}: {
  here: Here;
  st: StepView;
  mode: "worked" | "build" | "done";
  whatif: WhatIfMode | null;
  onDeeper: (part: string) => void;
}) {
  const { act, busy } = here;
  const rf = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  // the first part clicked, waiting for the second
  const [pick, setPick] = useState<string | null>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [argue, setArgue] = useState("");
  // where you dragged a part, until the server has it: kept only while the
  // server still has the part where it was when the drag began
  const [drag, setDrag] = useState<Record<string, { to: At; from: string }>>(
    {},
  );
  // each card's measured size, kept on the nodes: a node handed over without
  // it is hidden until React Flow measures it again
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  // a new step, or a new stage of it: nothing half-picked carries over
  const key = `${st.step}:${mode}:${st.onCase}`;
  const [keyFor, setKeyFor] = useState(key);
  if (keyFor !== key) {
    setKeyFor(key);
    setPick(null);
    setPop(null);
    setArgue("");
  }

  const frame = st.frame;
  const worked = mode === "worked" ? st.worked : null;
  const step = st.step;

  // the parts on the canvas and where they are drawn
  const parts = useMemo(() => {
    if (worked) {
      const at = tidy(
        frame,
        worked.parts.map((p) => ({ id: p.id, slot: p.slot })),
        worked.links,
      );
      return worked.parts.map((p) => ({ ...p, ...at[p.id] }));
    }
    const at = drawn(
      frame,
      st.placed.map((p) => ({ ...p, id: p.id })),
    );
    return st.placed.map((p) => ({ ...p, ...at[p.id] }));
  }, [worked, frame, st.placed]);
  // the frame grows to hold the parts in it, where they are drawn
  const span = spanOf(
    frame,
    parts.filter((p) => "slot" in p && p.slot),
  );
  // the zone for parts outside the frame, while any wait there
  const waiting =
    mode === "build" && (st.trayCount > 0 || st.placed.some((p) => !p.slot));
  const zones: Region[] = useMemo(() => {
    const rs = regions(frame, span);
    const z = waiting ? looseZone(frame, span) : null;
    return z ? [...rs, z] : rs;
  }, [frame, span, waiting]);

  // a part placed out of sight brings the view round to show it
  const count = parts.length;
  useEffect(() => {
    const el = box.current;
    if (!el || !count) return;
    const { x, y, zoom } = rf.getViewport();
    const out = rf.getNodes().some((n) => {
      if (n.type !== "part") return false;
      const sx = n.position.x * zoom + x;
      const sy = n.position.y * zoom + y;
      return (
        sx < 0 ||
        sy < 0 ||
        sx + NODE_W * zoom > el.clientWidth ||
        sy + NODE_H * zoom > el.clientHeight - 100
      );
    });
    if (out) void rf.fitView({ ...FIT, duration: 200 });
  }, [count, rf]);

  const rawKey = (p: { x: number; y: number; slot?: string }) =>
    `${p.x},${p.y},${p.slot ?? ""}`;
  const at: Record<string, At> = {};
  for (const p of parts) {
    const d = drag[p.id];
    const raw = st.placed.find((x) => x.id === p.id);
    at[p.id] = d && raw && d.from === rawKey(raw) ? d.to : { x: p.x, y: p.y };
  }

  const marks = new Map(st.check?.marks.map((m) => [m.link, m]) ?? []);
  const wrongSlot = new Set(
    st.check?.slots.filter((s) => !s.ok).map((s) => s.part) ?? [],
  );
  const word =
    frame.kind === "lanes"
      ? "not in its lane"
      : frame.kind === "boxes"
        ? "not in its box"
        : "not in its column";

  const nodes: Node[] = [
    ...zones.map((r, i): Node<RegionData> => ({
      id: `zone-${i}`,
      type: "region",
      position: { x: r.x, y: r.y },
      width: r.w,
      height: r.h,
      measured: { width: r.w, height: r.h },
      style: { width: r.w, height: r.h },
      data: {
        label: r.label,
        loose: !r.slot,
        wide: frame.kind === "lanes",
      },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: -1,
    })),
    ...parts.map((p): Node<PartData> => {
      const tone: Tone = worked
        ? worked.hidden === p.id
          ? "hidden"
          : "plain"
        : whatif
          ? whatif.found.includes(p.id)
            ? "found"
            : whatif.extra.includes(p.id)
              ? "extra"
              : whatif.picked.includes(p.id)
                ? "chosen"
                : "plain"
          : pick === p.id
            ? "pick"
            : "plain";
      return {
        id: p.id,
        type: "part",
        position: at[p.id],
        measured: sizes[`${key}:${p.id}`],
        draggable: mode === "build",
        data: {
          label: p.label,
          role: p.role,
          tone,
          fails: !!whatif && whatif.fails === p.label,
          badge:
            mode === "build" && wrongSlot.has(p.id) ? `⚠ ${word}` : undefined,
          onOut:
            mode === "build" && pick === p.id && st.help >= 2
              ? () => {
                  setPick(null);
                  void act("unplace", { step, part: p.id });
                }
              : undefined,
        },
      };
    }),
  ];

  const edges: Edge[] = [];
  // a second link between the same two parts (yours the wrong way, a ghost
  // hint beside it) steps out round them instead of lying on the first
  const pairs = new Map<string, number>();
  const spread = (e: Edge): Edge => {
    const k = [e.source, e.target].sort().join("|");
    const n = pairs.get(k) ?? 0;
    pairs.set(k, n + 1);
    return n
      ? ({
          ...e,
          type: "smoothstep",
          pathOptions: { offset: 24 + 18 * n },
        } as Edge)
      : e;
  };
  if (worked)
    for (const l of worked.links)
      edges.push(spread(edgeOf(l.id, l.from, l.to, l.rel, "plain", at)));
  else {
    for (const l of st.links) {
      const m = marks.get(l.id);
      edges.push(
        spread(
          l.given
            ? edgeOf(l.id, l.from, l.to, l.rel, "given", at, true)
            : edgeOf(
                l.id,
                l.from,
                l.to,
                m ? `${l.rel} ${MARK[m.mark].sym}` : l.rel,
                m ? m.mark : "plain",
                at,
                m?.mark === "extra",
              ),
        ),
      );
    }
    // a ghost from the hint ladder: the link drawn dashed, its verb for you
    if (mode === "build")
      for (const h of st.hints)
        if (
          h.rung === 3 &&
          h.from &&
          h.to &&
          at[h.from] &&
          at[h.to] &&
          !st.links.some((l) => l.from === h.from && l.to === h.to)
        )
          edges.push(
            spread(
              edgeOf(
                `ghost:${h.from}:${h.to}`,
                h.from,
                h.to,
                "?",
                "ghost",
                at,
                true,
              ),
            ),
          );
  }

  const where = (e: { clientX: number; clientY: number }): At => {
    const r = box.current?.getBoundingClientRect();
    return r
      ? {
          x: Math.min(e.clientX - r.left, r.width - 240),
          y: Math.min(e.clientY - r.top, r.height - 260),
        }
      : { x: 40, y: 40 };
  };

  const onDrop = (e: DragEvent) => {
    const part = e.dataTransfer.getData(PART_DRAG);
    if (!part || mode !== "build") return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const spot = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
    const slot = slotAt(frame, spot, span);
    void act("place", {
      step,
      part,
      x: Math.round(spot.x),
      y: Math.round(spot.y),
      ...(slot ? { slot } : {}),
    });
  };

  const doTidy = () => {
    const to = tidy(
      frame,
      st.placed.map((p) => ({ id: p.id, slot: p.slot })),
      st.links,
    );
    for (const p of st.placed) {
      const t = to[p.id];
      if (t && (Math.round(t.x) !== p.x || Math.round(t.y) !== p.y))
        void act("move", {
          step,
          part: p.id,
          x: Math.round(t.x),
          y: Math.round(t.y),
        });
    }
    window.setTimeout(() => void rf.fitView({ ...FIT, duration: 250 }), 400);
  };

  const popLink =
    pop?.kind === "link" ? st.links.find((l) => l.id === pop.id) : undefined;
  const popMark = popLink ? marks.get(popLink.id) : undefined;
  const popPart =
    pop?.kind === "part" ? parts.find((p) => p.id === pop.id) : undefined;

  return (
    <div
      ref={box}
      className="relative h-full min-h-0 w-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PART_DRAG)) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <ReactFlow
        // a fresh canvas per step and stage, so each opens framed to fit
        key={key}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionMode={"loose" as never}
        fitView
        fitViewOptions={FIT}
        minZoom={0.3}
        nodesConnectable={false}
        deleteKeyCode={null}
        onNodesChange={(changes) => {
          for (const ch of changes) {
            if (ch.type === "position" && ch.position && ch.dragging) {
              const raw = st.placed.find((x) => x.id === ch.id);
              if (raw)
                setDrag((d) => ({
                  ...d,
                  [ch.id]: { to: ch.position!, from: rawKey(raw) },
                }));
            }
            if (ch.type === "dimensions" && ch.dimensions) {
              const k = `${key}:${ch.id}`;
              const { width, height } = ch.dimensions;
              setSizes((s) =>
                s[k]?.width === width && s[k]?.height === height
                  ? s
                  : { ...s, [k]: { width, height } },
              );
            }
          }
        }}
        onNodeDragStop={(_, n) => {
          if (mode !== "build" || n.type !== "part") return;
          const p = {
            x: Math.round(n.position.x),
            y: Math.round(n.position.y),
          };
          const slot = slotAt(frame, p, span);
          void act("move", { step, part: n.id, ...p, slot: slot ?? null });
        }}
        onNodeClick={(e, n) => {
          if (n.type !== "part") return;
          setPop(null);
          if (whatif) return whatif.toggle(n.id);
          if (mode === "done")
            return setPop({ kind: "part", id: n.id, at: where(e) });
          if (mode !== "build") return;
          if (!pick || pick === n.id) return setPick(pick ? null : n.id);
          setPop({ kind: "verb", from: pick, to: n.id, at: where(e) });
        }}
        onEdgeClick={(e, ed) => {
          if (mode !== "build") return;
          setPick(null);
          if (ed.id.startsWith("ghost:")) {
            const [, from, to] = ed.id.split(":");
            return setPop({ kind: "verb", from, to, at: where(e) });
          }
          const l = st.links.find((x) => x.id === ed.id);
          if (l && !l.given) setPop({ kind: "link", id: l.id, at: where(e) });
        }}
        onPaneClick={() => {
          setPick(null);
          setPop(null);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--color-line)" />
        <Controls
          showInteractive={false}
          fitViewOptions={FIT}
          position="bottom-left"
          style={{ marginBottom: 96 }}
        />
      </ReactFlow>

      {mode === "build" && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-between gap-2 px-3">
          <div className="rounded-lg bg-surface/90 px-2.5 py-1 text-[12px] text-muted shadow-xs ring-1 ring-line">
            {pick
              ? `Now click the part “${parts.find((p) => p.id === pick)?.label ?? ""}” links to`
              : frame.kind === "free"
                ? "Click a part, then another, then pick a verb"
                : "Drag each part into its place; click a part, then another, then pick a verb"}
          </div>
          {st.placed.length > 1 && (
            <button
              onClick={doTidy}
              className="pointer-events-auto rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-[12px] text-body shadow-xs hover:border-primary"
            >
              Tidy
            </button>
          )}
        </div>
      )}

      {pop?.kind === "verb" && (
        <Popover at={pop.at} onClose={() => setPop(null)}>
          <div className="mb-1 text-[11.5px] text-muted">
            “{parts.find((p) => p.id === pop.from)?.label}” … “
            {parts.find((p) => p.id === pop.to)?.label}”
          </div>
          <VerbList
            verbs={st.verbs}
            onPick={(rel) => {
              setPop(null);
              setPick(null);
              void act("link", { step, from: pop.from, to: pop.to, rel });
            }}
          />
        </Popover>
      )}

      {pop?.kind === "link" && popLink && (
        <Popover at={pop.at} onClose={() => setPop(null)}>
          <div className="mb-1.5 text-[12px] text-body">
            “{labelOf(parts, popLink.from)}” <b>{popLink.rel}</b> “
            {labelOf(parts, popLink.to)}”
          </div>
          {popMark && (
            <div className="mb-1.5 text-[11.5px] text-muted">
              Last check: {MARK[popMark.mark].sym} {MARK[popMark.mark].word}
            </div>
          )}
          <div className="mb-1.5 flex gap-1.5">
            <SmallBtn
              onClick={() => {
                setPop(null);
                void act("relink", { step, link: popLink.id, reverse: true });
              }}
            >
              ↔ Reverse
            </SmallBtn>
            <SmallBtn
              onClick={() => {
                setPop(null);
                void act("unlink", { step, link: popLink.id });
              }}
            >
              Delete
            </SmallBtn>
          </div>
          <div className="mb-0.5 text-[10.5px] font-semibold tracking-wide text-faint uppercase">
            Change the verb
          </div>
          <VerbList
            verbs={st.verbs}
            current={popLink.rel}
            onPick={(rel) => {
              setPop(null);
              void act("relink", { step, link: popLink.id, rel });
            }}
          />
          {popMark?.mark === "extra" && (
            <ArgueBox
              link={popLink}
              text={argue}
              setText={setArgue}
              busy={busy}
              onSend={() => {
                setPop(null);
                void act("argue", { step, link: popLink.id, text: argue }).then(
                  (r) => {
                    if (!r.error) setArgue("");
                  },
                );
              }}
            />
          )}
        </Popover>
      )}

      {pop?.kind === "part" && popPart && (
        <Popover at={pop.at} onClose={() => setPop(null)}>
          <div className="text-[13px] font-semibold text-ink">
            {popPart.label}
          </div>
          {popPart.role && (
            <div className="mt-0.5 text-[12px] text-muted">{popPart.role}</div>
          )}
          <div className="mt-2">
            <SmallBtn
              disabled={busy}
              title={busy ? WAIT_TITLE : "A step of its own, under this one"}
              onClick={() => {
                setPop(null);
                onDeeper(popPart.id);
              }}
            >
              Go deeper on this part
            </SmallBtn>
          </div>
        </Popover>
      )}
    </div>
  );
}

const labelOf = (parts: { id: string; label: string }[], id: string) =>
  parts.find((p) => p.id === id)?.label ?? "";

function Popover({
  at,
  onClose,
  children,
}: {
  at: At;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute z-30 w-[230px] rounded-xl bg-surface p-2.5 shadow-lg ring-1 ring-line"
      style={{ left: Math.max(8, at.x), top: Math.max(8, at.y) }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-1 right-2 text-base leading-none text-faint hover:text-ink"
        title="Close"
      >
        ×
      </button>
      {children}
    </div>
  );
}

// the frame's verbs, by family, so a near verb sits next to the right one
export function VerbList({
  verbs,
  current,
  onPick,
}: {
  verbs: Verb[];
  current?: Verb;
  onPick: (v: Verb) => void;
}) {
  const fams = (Object.keys(FAMILIES) as Family[]).filter((f) =>
    verbs.some((v) => familyOf(v) === f),
  );
  return (
    <div className="max-h-56 space-y-1 overflow-y-auto">
      {fams.map((f) => (
        <div key={f} className="flex flex-wrap gap-1">
          {verbs
            .filter((v) => familyOf(v) === f)
            .map((v) => (
              <button
                key={v}
                onClick={() => onPick(v)}
                disabled={v === current}
                className="rounded-full border border-line-strong px-2 py-0.5 text-[12px] text-body hover:border-primary hover:text-primary-strong disabled:border-primary disabled:bg-primary-soft disabled:text-primary-strong"
              >
                {v}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

export function SmallBtn({
  children,
  onClick,
  disabled,
  title,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-2.5 py-1 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${primary ? "bg-primary text-on-primary hover:bg-primary-strong" : "border border-line-strong bg-surface text-body hover:border-primary hover:text-primary-strong"}`}
    >
      {children}
    </button>
  );
}

// a link Claude's model does not have: say in a line why it holds
export function ArgueBox({
  link,
  text,
  setText,
  busy,
  onSend,
}: {
  link: LinkView;
  text: string;
  setText: (t: string) => void;
  busy: boolean;
  onSend: () => void;
}) {
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="text-[11.5px] text-muted">
        Not in Claude's model, and not wrong. Think it holds here? Say why.
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="It holds because…"
        className="mt-1 block w-full resize-none rounded-lg border border-line-strong bg-surface px-2 py-1 text-[12.5px] outline-hidden focus:border-primary"
        aria-label={`Why ${link.rel} holds`}
      />
      <div className="mt-1 flex justify-end">
        <SmallBtn
          primary
          disabled={busy || !text.trim()}
          title={busy ? WAIT_TITLE : "One Claude move"}
          onClick={onSend}
        >
          Argue for it
        </SmallBtn>
      </div>
    </div>
  );
}
