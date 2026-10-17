import dagre from "@dagrejs/dagre";
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
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import {
  GROUPS,
  KINDS,
  type Comp,
  type DesignView,
  type KindId,
  type Load,
  type Reference,
  type Wire,
} from "../shared.ts";
import { fmt, GROUP_TONE, STATUS_TONE, utilText } from "./format.ts";
import { Icon } from "./Icon.tsx";

export type Picked = { type: "comp" | "wire"; id: string } | null;
type Act = (name: string, args: Record<string, unknown>) => void;

export const NODE_W = 172;
const NODE_H = 84;
const DRAG_TYPE = "application/x-living-map-kind";
const FIT = { padding: 0.25, maxZoom: 1 };
// the message box covers the bottom of the canvas: new parts land above it
const COMPOSER_H = 96;

type Side = "top" | "right" | "bottom" | "left";
type At = { x: number; y: number };

// A wire runs between the facing sides of its two parts: side to side when
// they sit next to each other, top to bottom when one is above the other. The
// second of two opposite wires between the same parts loops round instead, so
// the two can be told apart.
function sides(a: At, b: At, back: boolean): [Side, Side] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const across = Math.abs(dx) - NODE_W > Math.abs(dy) - NODE_H;
  if (across)
    return back
      ? ["bottom", "bottom"]
      : dx > 0
        ? ["right", "left"]
        : ["left", "right"];
  return back
    ? ["right", "right"]
    : dy > 0
      ? ["bottom", "top"]
      : ["top", "bottom"];
}

type CompData = { comp: Comp; load?: Load; flagged: boolean; ghost: boolean };

// one component: what it is, its scale, and how loaded it is right now
function CompNode({ data, selected }: NodeProps<Node<CompData>>) {
  const { comp, load, flagged, ghost } = data;
  const k = KINDS[comp.kind];
  const tone = GROUP_TONE[k.group];
  const st = STATUS_TONE[load?.status ?? "idle"];
  const scale = [
    comp.count > 1 && `×${comp.count}`,
    k.shards && comp.shards > 1 && `${comp.shards} shards`,
  ]
    .filter(Boolean)
    .join(", ");
  const ring = selected
    ? "ring-2 ring-primary"
    : flagged
      ? "ring-2 ring-hint"
      : load && (load.status === "over" || load.status === "backlog")
        ? `ring-2 ${st.ring}`
        : "ring-1 ring-line-strong";
  // easy to grab: a wide invisible hit area around a dot that grows on hover
  const handle =
    "!h-3.5 !w-3.5 !border-2 !border-surface !bg-line-strong hover:!bg-primary hover:!scale-125 transition-transform before:absolute before:-inset-2 before:content-['']";
  return (
    <div
      className={`rounded-xl bg-surface shadow-xs ${ring} ${ghost ? "opacity-90" : ""}`}
      style={{ width: NODE_W }}
      title={`${comp.label} (${k.label}): ${k.hint}`}
    >
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={Position[(side[0].toUpperCase() + side.slice(1)) as "Top"]}
          className={handle}
          isConnectable={!ghost}
        />
      ))}
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.soft} ${tone.fg}`}
        >
          <Icon kind={comp.kind} />
        </span>
        <div className="min-w-0">
          {/* the reference's names carry the lesson ("sharded by tweet id"): shown whole */}
          <div
            className={`text-[13px] font-semibold text-ink ${ghost ? "leading-tight" : "truncate"}`}
          >
            {comp.label}
          </div>
          <div className="truncate text-[11px] text-muted">
            {k.label}
            {scale && ` · ${scale}`}
          </div>
        </div>
      </div>
      {!ghost && (
        <div className="px-2.5 pt-1.5 pb-2">
          {load && load.status !== "idle" ? (
            <>
              <div className="flex justify-between gap-1 text-[10.5px] whitespace-nowrap tabular-nums">
                <span className="truncate text-muted">
                  {fmt(load.reads)} r · {fmt(load.writes)} w /s
                </span>
                <span className={st.text}>{utilText(load.util)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel">
                <div
                  className={`h-full ${st.bar}`}
                  style={{
                    width: `${Math.min(100, Math.max(4, load.util * 100))}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="text-[10.5px] text-faint">no traffic yet</div>
          )}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { comp: CompNode };

const wireLabel = (w: { carries: Wire["carries"]; times: number }) =>
  [w.carries !== "both" && `${w.carries}s`, w.times > 1 && `×${w.times}`]
    .filter(Boolean)
    .join(" ");

// the reference has no positions: lay it out top to bottom, which fits a wide screen
function laidOut(ref: Reference) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 30,
    ranksep: 56,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const c of ref.comps) g.setNode(c.id, { width: NODE_W, height: 64 });
  for (const w of ref.wires) g.setEdge(w.from, w.to);
  dagre.layout(g);
  return ref.comps.map((c): Comp => ({
    ...c,
    x: g.node(c.id).x - NODE_W / 2,
    y: g.node(c.id).y - 32,
    count: 1,
    shards: 1,
    by: "claude",
  }));
}

export function DesignCanvas({
  view,
  showReference,
  flagged,
  picked,
  onPick,
  act,
}: {
  view: DesignView;
  showReference: boolean;
  flagged: Set<string>;
  picked: Picked;
  onPick: (p: Picked) => void;
  act: Act;
}) {
  const rf = useReactFlow();
  const { screenToFlowPosition } = rf;
  const box = useRef<HTMLDivElement>(null);
  // where you are dragging a component, until the server has the new position
  const [drag, setDrag] = useState<Record<string, At>>({});
  // each card's measured size, kept on the nodes: a node handed over without
  // it is hidden until React Flow measures it again, which a card whose size
  // did not change may never get, leaving the canvas blank
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  // spots just asked for, so quick clicks in the palette do not stack parts
  // before the server has them
  const recent = useRef<(At & { at: number })[]>([]);
  const ref = showReference ? view.reference : null;
  const mode = ref ? "reference" : "design";

  const nodes: Node<CompData>[] = useMemo(() => {
    const comps = ref ? laidOut(ref) : view.comps;
    return comps.map((c) => ({
      id: c.id,
      type: "comp",
      measured: sizes[`${mode}:${c.id}`],
      position: (!ref && drag[c.id]) || { x: c.x, y: c.y },
      data: {
        comp: c,
        load: ref ? undefined : view.load[c.id],
        flagged: flagged.has(c.id),
        ghost: !!ref,
      },
      selected: !ref && picked?.type === "comp" && picked.id === c.id,
      draggable: !ref,
    }));
  }, [ref, mode, view.comps, view.load, drag, sizes, flagged, picked]);

  const edges: Edge[] = useMemo(() => {
    const wires = ref
      ? ref.wires.map((w, i) => ({ ...w, id: `ref-${i}` }))
      : view.wires;
    const at = new Map(nodes.map((n) => [n.id, n.position]));
    const pairs = new Set(wires.map((w) => `${w.from}>${w.to}`));
    return wires.map((w) => {
      const to = ref ? undefined : view.load[w.to];
      const hot = to && (to.status === "over" || to.status === "backlog");
      const color = hot ? "var(--color-danger)" : "var(--color-line-strong)";
      const back = pairs.has(`${w.to}>${w.from}`) && w.from > w.to;
      const [sourceHandle, targetHandle] = sides(
        at.get(w.from) ?? { x: 0, y: 0 },
        at.get(w.to) ?? { x: 0, y: 0 },
        back,
      );
      return {
        id: w.id,
        source: w.from,
        target: w.to,
        sourceHandle,
        targetHandle,
        label: wireLabel(w) || undefined,
        animated: !!to?.async,
        selected: !ref && picked?.type === "wire" && picked.id === w.id,
        style: { stroke: color, strokeWidth: 1.6 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 16,
          height: 16,
        },
        labelStyle: { fontSize: 11, fill: "var(--color-muted)" },
        labelBgStyle: { fill: "var(--color-surface)" },
      };
    });
  }, [ref, nodes, view.wires, view.load, picked]);

  // When the canvas narrows (the review opens, a panel slides in, the window
  // shrinks), bring back into view any part that the change left out of sight.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let t = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        const { x, y, zoom } = rf.getViewport();
        const out = rf.getNodes().some((n) => {
          const sx = n.position.x * zoom + x;
          const sy = n.position.y * zoom + y;
          return (
            sx < 0 ||
            sy < 0 ||
            sx + NODE_W * zoom > el.clientWidth ||
            sy + NODE_H * zoom > el.clientHeight
          );
        });
        if (out) void rf.fitView({ ...FIT, duration: 250 });
      }, 220);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [rf]);

  const addAt = (kind: KindId, clientX: number, clientY: number) => {
    const p = screenToFlowPosition({ x: clientX, y: clientY });
    act("add", { kind, x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  };
  // a click adds the part at the free spot nearest the middle of the view, so
  // parts added one after another sit side by side instead of on top of each other
  const addInMiddle = (kind: KindId) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const mid = screenToFlowPosition({
      x: r.left + r.width / 2,
      y: r.top + (r.height - COMPOSER_H) / 2,
    });
    // what is visible of the canvas, above the message box
    const tl = screenToFlowPosition({ x: r.left + 8, y: r.top + 8 });
    const br = screenToFlowPosition({
      x: r.right - 8,
      y: r.bottom - COMPOSER_H,
    });
    const now = Date.now();
    recent.current = recent.current.filter((p) => now - p.at < 3000);
    const taken: At[] = [...view.comps, ...recent.current];
    const free = (x: number, y: number) =>
      taken.every(
        (c) =>
          Math.abs(c.x - x) > NODE_W + 24 || Math.abs(c.y - y) > NODE_H + 24,
      );
    const seen = (x: number, y: number) =>
      x >= tl.x && y >= tl.y && x + NODE_W <= br.x && y + NODE_H <= br.y;
    const place = (x: number, y: number) => {
      const p = { x: Math.round(x), y: Math.round(y) };
      recent.current.push({ ...p, at: now });
      act("add", { kind, ...p });
    };
    const start = { x: mid.x - NODE_W / 2, y: mid.y - NODE_H / 2 };
    // a free spot in sight first; failing that, any free spot
    for (const inSight of [true, false])
      for (let ring = 0; ring < 12; ring++)
        for (let i = -ring; i <= ring; i++)
          for (const [dx, dy] of [
            [i, -ring],
            [i, ring],
            [-ring, i],
            [ring, i],
          ]) {
            const x = start.x + dx * (NODE_W + 40);
            const y = start.y + dy * (NODE_H + 40);
            if (free(x, y) && (!inSight || seen(x, y))) return place(x, y);
          }
    place(start.x, start.y);
  };
  const onDrop = (e: DragEvent) => {
    const kind = e.dataTransfer.getData(DRAG_TYPE);
    if (!kind || !(kind in KINDS)) return;
    e.preventDefault();
    addAt(kind as KindId, e.clientX, e.clientY);
  };

  return (
    <div className="flex h-full">
      {!ref && <Palette onAdd={addInMiddle} />}
      <div
        ref={box}
        className="relative h-full min-w-0 flex-1"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
        }}
        onDrop={onDrop}
      >
        <ReactFlow
          // a fresh canvas per view, so each opens framed to fit
          key={mode}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          connectionMode={"loose" as never}
          fitView
          fitViewOptions={FIT}
          minZoom={0.3}
          deleteKeyCode={ref ? null : ["Backspace", "Delete"]}
          nodesConnectable={!ref}
          onNodesChange={(changes) => {
            for (const ch of changes) {
              if (ch.type === "position" && ch.position)
                setDrag((d) => ({ ...d, [ch.id]: ch.position! }));
              if (ch.type === "dimensions" && ch.dimensions) {
                const k = `${mode}:${ch.id}`;
                const { width, height } = ch.dimensions;
                setSizes((s) =>
                  s[k]?.width === width && s[k]?.height === height
                    ? s
                    : { ...s, [k]: { width, height } },
                );
              }
            }
          }}
          // Delete removes the parts (their wires go with them, and come back
          // with Undo) and any other selected wires
          onDelete={({ nodes: gone, edges: cut }) => {
            const ids = new Set(gone.map((n) => n.id));
            for (const n of gone) act("remove", { id: n.id });
            for (const e of cut)
              if (!ids.has(e.source) && !ids.has(e.target))
                act("unwire", { id: e.id });
          }}
          onNodeDragStop={(_, n) =>
            act("update", {
              id: n.id,
              x: Math.round(n.position.x),
              y: Math.round(n.position.y),
            })
          }
          onConnect={(c) => {
            if (c.source && c.target)
              act("connect", { from: c.source, to: c.target });
          }}
          onNodeClick={(_, n) => !ref && onPick({ type: "comp", id: n.id })}
          onEdgeClick={(_, e) => !ref && onPick({ type: "wire", id: e.id })}
          onPaneClick={() => onPick(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="var(--color-line)" />
          {/* above the message box, which covers the bottom of the canvas, and
              on the left, clear of the review on a narrow window */}
          <Controls
            showInteractive={false}
            position="bottom-left"
            style={{ marginBottom: COMPOSER_H }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export const PALETTE_W = 168;

// the components you can use, by group: drag one onto the canvas, or click it
function Palette({ onAdd }: { onAdd: (kind: KindId) => void }) {
  return (
    <div
      style={{ width: PALETTE_W }}
      className="h-full shrink-0 overflow-y-auto border-r border-line bg-surface px-2 py-2"
    >
      {GROUPS.map((g) => (
        <div key={g} className="mb-1.5">
          <div className="px-1 pb-0.5 text-[10px] font-semibold tracking-wide text-faint uppercase">
            {g}
          </div>
          {(Object.keys(KINDS) as KindId[])
            .filter((k) => KINDS[k].group === g)
            .map((k) => (
              <button
                key={k}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, k);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(k)}
                title={KINDS[k].hint}
                className="flex w-full cursor-grab items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] text-body hover:bg-panel active:cursor-grabbing"
              >
                <span className={GROUP_TONE[g].fg}>
                  <Icon kind={k} size={16} />
                </span>
                {KINDS[k].label}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
