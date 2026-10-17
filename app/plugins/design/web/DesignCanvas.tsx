import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  getViewportForBounds,
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
  type Side,
  type Wire,
} from "../shared.ts";
import { fmt, GROUP_TONE, STATUS_TONE, utilText } from "./format.ts";
import { Icon } from "./Icon.tsx";
import { NODE_H, NODE_W, onWire, route, type At, type Box } from "./route.ts";

export type Picked = { type: "comp" | "wire"; id: string } | null;
type Act = (name: string, args: Record<string, unknown>) => void;

export { NODE_W };
const DRAG_TYPE = "application/x-living-map-kind";
// the message box covers the bottom of the canvas: new parts land above it
export const COMPOSER_H = 96;
// framed clear of the buttons and warnings along the top and of the message
// box at the bottom, from the first view and from the Fit button alike
const FIT = {
  padding: { top: "72px", bottom: `${COMPOSER_H + 24}px`, x: "8%" },
  maxZoom: 1,
} as const;

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
      title={`${comp.label} (${k.label}${scale ? `, ${scale}` : ""}): ${k.hint}`}
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
          {/* the scale goes on a line of its own when it does not fit */}
          <div className="flex flex-wrap gap-x-1 text-[11px] text-muted">
            <span className="max-w-full truncate">{k.label}</span>
            {scale && <span className="max-w-full truncate">· {scale}</span>}
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
  const { screenToFlowPosition, flowToScreenPosition } = rf;
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
  // when a wire drag last ended: letting go over a part is not a click on it
  const wiredAt = useRef(0);
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
    const boxes = new Map<string, Box>(
      nodes.map((n) => [
        n.id,
        { ...n.position, w: n.measured?.width, h: n.measured?.height },
      ]),
    );
    const routes = route(wires, boxes);
    return wires.map((w) => {
      const to = ref ? undefined : view.load[w.to];
      const hot = to && (to.status === "over" || to.status === "backlog");
      const color = hot ? "var(--color-danger)" : "var(--color-line-strong)";
      const [sourceHandle, targetHandle] = routes.get(w.id) ?? [
        "right",
        "left",
      ];
      return {
        id: w.id,
        source: w.from,
        target: w.to,
        sourceHandle,
        targetHandle,
        // a loop from one side back to the same side: a curve would run
        // along the cards' edge, out of sight, so it steps out round them
        ...(sourceHandle === targetHandle && {
          type: "smoothstep",
          pathOptions: { offset: 28 },
        }),
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
  // When it widens again, zoom back in if the design was shrunk to fit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let t = 0;
    // the size the view was last framed for
    let framed = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        const { x, y, zoom } = rf.getViewport();
        const all = rf.getNodes();
        const out = all.some((n) => {
          const sx = n.position.x * zoom + x;
          const sy = n.position.y * zoom + y;
          return (
            sx < 0 ||
            sy < 0 ||
            sx + NODE_W * zoom > el.clientWidth ||
            sy + NODE_H * zoom > el.clientHeight
          );
        });
        const grew =
          el.clientWidth > framed.w + 40 || el.clientHeight > framed.h + 40;
        const fits =
          all.length > 0 &&
          getViewportForBounds(
            rf.getNodesBounds(all),
            el.clientWidth,
            el.clientHeight,
            0.3,
            FIT.maxZoom,
            FIT.padding,
          ).zoom;
        if (out || (grew && fits && fits > zoom * 1.15)) {
          framed = { w: el.clientWidth, h: el.clientHeight };
          // at once: a fit still animating would be judged again mid-way
          void rf.fitView(FIT);
        }
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
    // what floats over the canvas (the buttons and notices along the top, a
    // floating review) hides a part as surely as the canvas's edge does
    const covers = [
      ...(box.current
        ?.closest("[data-design-stage]")
        ?.querySelectorAll("[data-keep-clear]") ?? []),
    ].map((el) => el.getBoundingClientRect());
    const now = Date.now();
    recent.current = recent.current.filter((p) => now - p.at < 3000);
    const taken: At[] = [...view.comps, ...recent.current];
    // clear of the cards, and of the wires: a card across a wire reads as
    // wired in when it is not
    const boxes = new Map<string, Box>(
      nodes.map((n) => [
        n.id,
        { ...n.position, w: n.measured?.width, h: n.measured?.height },
      ]),
    );
    const drawn = edges.map((e) => ({
      from: e.source,
      to: e.target,
      sides: [e.sourceHandle, e.targetHandle] as [Side, Side],
    }));
    const free = (x: number, y: number) =>
      taken.every(
        (c) =>
          Math.abs(c.x - x) > NODE_W + 24 || Math.abs(c.y - y) > NODE_H + 24,
      ) && !onWire({ x, y }, drawn, boxes);
    // the whole card on the canvas, above the message box, under nothing
    const seen = (x: number, y: number) => {
      const a = flowToScreenPosition({ x, y });
      const b = flowToScreenPosition({ x: x + NODE_W, y: y + NODE_H });
      return (
        a.x >= r.left + 8 &&
        a.y >= r.top + 8 &&
        b.x <= r.right - 8 &&
        b.y <= r.bottom - COMPOSER_H &&
        covers.every(
          (c) =>
            b.x + 8 <= c.left ||
            a.x - 8 >= c.right ||
            b.y + 8 <= c.top ||
            a.y - 8 >= c.bottom,
        )
      );
    };
    const place = (x: number, y: number, inSight: boolean) => {
      const p = { x: Math.round(x), y: Math.round(y) };
      recent.current.push({ ...p, at: now });
      act("add", { kind, ...p });
      if (inSight) return;
      // no room in sight: zoom out to show it with the rest
      const all = rf.getNodes();
      const b = all.length
        ? rf.getNodesBounds(all)
        : { x: p.x, y: p.y, width: 0, height: 0 };
      const x0 = Math.min(b.x, p.x);
      const y0 = Math.min(b.y, p.y);
      const vp = getViewportForBounds(
        {
          x: x0,
          y: y0,
          width: Math.max(b.x + b.width, p.x + NODE_W) - x0,
          height: Math.max(b.y + b.height, p.y + NODE_H) - y0,
        },
        r.width,
        r.height,
        0.3,
        FIT.maxZoom,
        FIT.padding,
      );
      void rf.setViewport(vp, { duration: 200 });
    };
    const start = { x: mid.x - NODE_W / 2, y: mid.y - NODE_H / 2 };
    // a free spot in sight first, on a grid of half a card so the gaps
    // between parts spread over the canvas count; failing that, any free spot
    for (const [inSight, step, rings] of [
      [true, 0.5, 24],
      [false, 1, 12],
    ] as const)
      for (let ring = 0; ring < rings; ring++)
        for (let i = -ring; i <= ring; i++)
          for (const [dx, dy] of [
            [i, -ring],
            [i, ring],
            [-ring, i],
            [ring, i],
          ]) {
            const x = start.x + dx * step * (NODE_W + 40);
            const y = start.y + dy * step * (NODE_H + 40);
            if (free(x, y) && (!inSight || seen(x, y)))
              return place(x, y, inSight);
          }
    place(start.x, start.y, false);
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
          onConnectEnd={() => {
            wiredAt.current = Date.now();
          }}
          // the dots you dragged between are kept: the wire runs between them
          onConnect={(c) => {
            if (c.source && c.target)
              act("connect", {
                from: c.source,
                to: c.target,
                fromSide: c.sourceHandle,
                toSide: c.targetHandle,
              });
          }}
          onNodeClick={(_, n) => {
            if (!ref && Date.now() - wiredAt.current > 300)
              onPick({ type: "comp", id: n.id });
          }}
          onEdgeClick={(_, e) => !ref && onPick({ type: "wire", id: e.id })}
          onPaneClick={() => onPick(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="var(--color-line)" />
          {/* above the message box, which covers the bottom of the canvas, and
              on the left, clear of the review on a narrow window */}
          <Controls
            showInteractive={false}
            fitViewOptions={FIT}
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
