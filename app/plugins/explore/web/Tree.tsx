import {
  Background,
  BaseEdge,
  ControlButton,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CARD_W,
  frameOf,
  SLOT,
  SPINE,
  treeLayout,
  type TreeEdge,
} from "./treeLayout.ts";
import { exploreView, questionState, tagOf } from "./view.ts";
import type { MapDoc, MapNode } from "../../../shared/model.ts";
import { lookOf } from "../../../web/components/look.ts";
import { NodeCard } from "../../../web/components/NodeCard.tsx";
import { setAside } from "../../../web/lib/layout.ts";

// the floating message box, and Claude's reply above it, cover the bottom of
// the canvas: frame above both
const FRAME = { top: 24, left: 24, right: 24, bottom: 200 };
const px = (f: typeof FRAME) =>
  ({
    top: `${f.top}px`,
    left: `${f.left}px`,
    right: `${f.right}px`,
    bottom: `${f.bottom}px`,
  }) as const;

// The card as Learn draws it, with the Tree's own handles: a question's
// line leaves its bottom for the row under it, a column's runs down the
// spine near the left edge and into each card's left side. NodeCard keeps
// its own left and right handles, which no edge here uses.
function TreeCard(props: NodeProps) {
  const hidden = { opacity: 0 };
  return (
    <>
      <NodeCard {...props} />
      <Handle id="top" type="target" position={Position.Top} style={hidden} />
      <Handle id="side" type="target" position={Position.Left} style={hidden} />
      <Handle
        id="down"
        type="source"
        position={Position.Bottom}
        style={hidden}
      />
      <Handle
        id="spine"
        type="source"
        position={Position.Bottom}
        style={{ ...hidden, left: SPINE }}
      />
    </>
  );
}
const nodeTypes = { map: TreeCard };

// Square lines along the waypoints the layout gave: under the question
// along its bus (and for a wrapped row down the trunk on the left to that
// row's bus), then down into the card; down a column's spine, then across;
// for a question's notes, along its bus to their spine, down, then across.
function TreeLine({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
}: EdgeProps) {
  const e = data as TreeEdge | undefined;
  const path =
    e?.kind === "stack" && e.bus !== undefined && e.spine !== undefined
      ? `M ${sourceX} ${sourceY} V ${e.bus} H ${e.spine} V ${targetY} H ${targetX}`
      : e?.kind === "row" && e.bus !== undefined
        ? `M ${sourceX} ${sourceY} V ${e.bus}` +
          (e.trunk !== undefined && e.rowBus !== undefined
            ? ` H ${e.trunk} V ${e.rowBus}`
            : "") +
          ` H ${targetX} V ${targetY}`
        : `M ${sourceX} ${sourceY} V ${targetY} H ${targetX}`;
  return <BaseEdge path={path} style={style} />;
}
const edgeTypes = { tree: TreeLine };

// the smallest zoom a card can still be read at: a tree too big to read
// whole opens at its question and the cards right under it, and you pan
// down their columns for the rest
const READABLE = 0.7;
// the node panel (420px wide, 12px from the edge) covers the right of the
// canvas: new work is framed to its left, unless the canvas is too narrow
const PANEL_W = 420 + 12;

// Rough height from text, so the tree lays out before the browser measures.
function heightOf(n: MapNode) {
  const lines = (s: string, per: number) =>
    Math.max(1, Math.ceil(s.length / per));
  return (
    54 + lines(n.title, 22) * 21 + (n.summary ? lines(n.summary, 30) * 18 : 0)
  );
}

// Explore's Tree tab: the question on top, what is under it side by side,
// and each branch down its own column (treeLayout.ts). The app owns the
// selection: a click selects one node, Shift-click adds or removes, a click
// on empty canvas clears. A selected card unfolds its branch.
export function Tree({
  map,
  showDropped,
  selected,
  workingId,
  busy,
  panelOpen,
  onSelect,
}: {
  map: MapDoc;
  showDropped: boolean;
  selected: string[];
  workingId: string | null;
  // Claude is making a move
  busy: boolean;
  panelOpen: boolean;
  onSelect: (ids: string[]) => void;
}) {
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const frame = useMemo(
    () =>
      panelOpen && width > PANEL_W * 2
        ? { ...FRAME, right: PANEL_W + 24 }
        : FRAME,
    [panelOpen, width],
  );
  // read when a fit runs: the panel opening is no reason to frame again
  const framing = useRef(frame);
  useEffect(() => {
    framing.current = frame;
  }, [frame]);
  const view = exploreView(map);
  // what you want is the board's rail, never a card on the tree: there it
  // read as a fact, and a sub-choice's wants crowded its options
  const wants = useMemo(() => new Set(view?.wants ?? []), [view]);
  const visible = useMemo(
    () =>
      Object.values(map.nodes).filter(
        (n) =>
          (showDropped || !setAside(map.nodes, n.id)) &&
          !(
            wants.has(n.id) &&
            !Object.values(map.nodes).some((x) => x.parent === n.id)
          ),
      ),
    [map, showDropped, wants],
  );
  // each card's measured size, kept on the nodes: the layout hands over new
  // nodes on every change, and one without a size is hidden until React Flow
  // measures it again, which a card whose size did not change may never get,
  // leaving the tree blank but for the newest card
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  // A set-aside branch, and a settled question below the root, folds to its
  // own card: what is under it is done with, and drawn out it pushed the
  // open work off the screen. Selecting the card, or anything under it,
  // unfolds it.
  const settled = useMemo(
    () =>
      new Set(
        (view?.questions ?? [])
          .filter((q) => q.settled && q.id !== view?.root)
          .map((q) => q.id),
      ),
    [view],
  );
  const opened = useMemo(() => {
    const ids = new Set<string>();
    for (const id of selected)
      for (
        let n: MapNode | undefined = map.nodes[id], i = 0;
        n && i < 100;
        i++
      ) {
        ids.add(n.id);
        n = n.parent ? map.nodes[n.parent] : undefined;
      }
    return ids;
  }, [selected, map.nodes]);
  // as wide as the room at a readable zoom, then a new row; at least three
  // columns, and never wider for the panel opening, which would reflow
  const maxW = Math.max(
    3 * SLOT + 2 * 32,
    ((width || window.innerWidth) - FRAME.left - FRAME.right) / READABLE,
  );
  const tree = useMemo(
    () =>
      treeLayout(visible, {
        maxW,
        heightOf: (n) => sizes[n.id]?.height ?? heightOf(n),
        folds: (n) =>
          !opened.has(n.id) &&
          (settled.has(n.id) || (!!n.parent && setAside(map.nodes, n.id))),
      }),
    [visible, maxW, sizes, opened, settled, map.nodes],
  );
  const laid = useMemo(() => {
    const shown = visible.filter((n) => tree.boxes[n.id]);
    return {
      nodes: shown.map((n): Node => ({
        id: n.id,
        type: "map",
        position: { x: tree.boxes[n.id].x, y: tree.boxes[n.id].y },
        data: { node: n },
      })),
      edges: tree.edges.map((e): Edge => {
        const n = map.nodes[e.target];
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.kind === "column" ? "spine" : "down",
          targetHandle: e.kind === "row" ? "top" : "side",
          type: "tree",
          data: e,
          style: {
            stroke:
              n?.status === "dropped" || n?.dropped
                ? "var(--color-line-strong)"
                : n?.status === "chosen"
                  ? "var(--color-success)"
                  : "var(--color-faint)",
            strokeWidth: n?.status === "chosen" ? 2 : 1.2,
          },
        };
      }),
    };
  }, [visible, tree, map.nodes]);
  const threads = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of Object.values(map.threads ?? {}))
      c[t.nodeId] = (c[t.nodeId] ?? 0) + 1;
    return c;
  }, [map.threads]);
  const nodes = useMemo(
    () =>
      laid.nodes.map((n) => {
        const was = map.nodes[n.id];
        // a question's card says where it stands as the stand line does
        const state = questionState(view, was);
        const node =
          state &&
          !was.dropped &&
          (was.status === "open" || was.status === "answered") &&
          (state === "decided") !== (was.status === "answered")
            ? {
                ...was,
                status:
                  state === "decided"
                    ? ("answered" as const)
                    : ("open" as const),
              }
            : was;
        const tag =
          state === "leaning" ? "leaning" : tagOf(view, map.nodes, node);
        const folded = tree.folded[n.id];
        return {
          ...n,
          measured: sizes[n.id],
          selected: selected.includes(n.id),
          data: {
            ...n.data,
            node,
            purpose: map.purpose,
            threads: threads[n.id] ?? 0,
            working: n.id === workingId,
            // the one line a folded branch is summed up in
            tag: folded
              ? `${tag ?? lookOf(node, map.purpose).tag} · ▸ ${folded} folded`
              : tag,
          },
        };
      }),
    [
      laid,
      tree,
      sizes,
      selected,
      map.purpose,
      map.nodes,
      view,
      threads,
      workingId,
    ],
  );
  const { fitView, getViewport, setViewport } = useReactFlow();
  const transform = useStore((s) => s.transform);

  // the room the tree is framed in, on screen, above the message box and
  // beside the panel
  const roomOf = (f: typeof FRAME) => ({
    left: f.left,
    top: f.top,
    w: Math.max(width - f.left - f.right, 200),
    h: Math.max(height - f.top - f.bottom, 200),
  });

  // The whole tree when it reads whole, else its question and the cards
  // right under it (frameOf). The first frame is instant, so the camera
  // does not sweep from one frame to another as the tree opens.
  const frameWhole = (duration = 300) =>
    setViewport(
      frameOf(tree, roomOf(framing.current), { readable: READABLE }),
      { duration },
    );

  // The camera holds still: it frames the tree when it first opens and from
  // the fit button, never on its own as Claude adds nodes, so what you were
  // reading stays where you left it. New nodes light up a pill instead, and
  // the pill frames them.
  // the layout as it is when the fit runs, not when it was asked for
  const frameNow = useEffectEvent(
    (duration: number) => void frameWhole(duration),
  );
  // once the cards are measured and laid out at their measured size, or
  // there is nothing to frame yet
  const measured =
    useNodesInitialized() && laid.nodes.every((n) => sizes[n.id]);
  const count = laid.nodes.length;
  // A lone question is no tree yet: while Claude's first move lays it out,
  // card by card, the tree is framed whole as it grows, and once more when
  // the move ends. After that the camera is yours.
  const [growing, setGrowing] = useState(count <= 1);
  if (growing && count > 1 && !busy) setGrowing(false);
  const fitKey = growing ? `growing ${count}` : "whole";
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!measured || fitted.current === fitKey) return;
    const first = fitted.current === null;
    fitted.current = fitKey;
    requestAnimationFrame(() => frameNow(first ? 0 : 300));
  }, [measured, fitKey]);
  // the nodes you have been shown: every node the map had when the tree
  // opened, those of the first move (framed as they came), and those the
  // pill framed since
  const [seen, setSeen] = useState(() => new Set(Object.keys(map.nodes)));
  if (growing && seen.size !== Object.keys(map.nodes).length)
    setSeen(new Set(Object.keys(map.nodes)));
  // The layout moves cards as the tree changes (a branch unfolds, a column
  // grows), so the card you are reading would jump: the camera follows it
  // instead (the card you selected, else the one nearest the middle of what
  // you see, where it was before the change), so it stays where it was on
  // screen.
  const lastAt = useRef<Map<string, { x: number; y: number }> | null>(null);
  useLayoutEffect(() => {
    const now = new Map(laid.nodes.map((n) => [n.id, n.position]));
    const was = lastAt.current;
    lastAt.current = now;
    if (growing || !was) return;
    const both = (id: string) => was.has(id) && now.has(id);
    const v = getViewport();
    let id = selected.find(both);
    if (!id) {
      const cx = (width / 2 - v.x) / v.zoom;
      const cy = (Math.max(height - FRAME.bottom, 200) / 2 - v.y) / v.zoom;
      let best = Infinity;
      for (const [k, p] of was) {
        if (!now.has(k)) continue;
        const sz = sizes[k] ?? { width: CARD_W, height: 120 };
        const d =
          (p.x + sz.width / 2 - cx) ** 2 + (p.y + sz.height / 2 - cy) ** 2;
        if (d < best) {
          best = d;
          id = k;
        }
      }
    }
    const a = id ? was.get(id) : undefined;
    const b = id ? now.get(id) : undefined;
    if (a && b && (a.x !== b.x || a.y !== b.y))
      void setViewport({
        x: v.x - (b.x - a.x) * v.zoom,
        y: v.y - (b.y - a.y) * v.zoom,
        zoom: v.zoom,
      });
  }, [laid, selected, growing, width, height, sizes, getViewport, setViewport]);
  const fresh = laid.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  const showNew = () => {
    const ids = new Set(fresh);
    for (const id of fresh) {
      const p = map.nodes[id]?.parent;
      if (p && laid.nodes.some((n) => n.id === p)) ids.add(p);
    }
    void (async () => {
      await fitView({
        nodes: [...ids].map((id) => ({ id })),
        padding: px(framing.current),
        duration: 300,
        maxZoom: 1,
        minZoom: READABLE,
      });
      // more new cards than fit at a readable zoom: start from the first
      // of them, at the top, rather than from their middle
      const v = getViewport();
      const top = Math.min(
        ...laid.nodes.filter((n) => ids.has(n.id)).map((n) => n.position.y),
      );
      if (v.zoom <= READABLE + 0.001 && Number.isFinite(top))
        await setViewport(
          { ...v, y: FRAME.top - top * v.zoom },
          { duration: 200 },
        );
    })();
    setSeen(new Set([...seen, ...Object.keys(map.nodes)]));
  };
  // The cards past the bottom of the room, and above its top: a tree too
  // tall to read whole runs on down its columns, and the pill says so (cut
  // cards under the message box said nothing).
  const [tx, ty, zoom] = transform;
  const roomBottom = height - FRAME.bottom;
  const beyond = (dir: 1 | -1) =>
    Object.values(tree.boxes).filter((b) =>
      dir > 0 ? b.y * zoom + ty > roomBottom : (b.y + b.h) * zoom + ty < 0,
    );
  const below = height ? beyond(1) : [];
  const above = height ? beyond(-1) : [];
  // a page down (or up) the columns, keeping a little of what you saw
  const pan = (dir: 1 | -1) =>
    void setViewport(
      { x: tx, y: ty - dir * 0.8 * (roomBottom - FRAME.top), zoom },
      { duration: 300 },
    );

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={laid.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        elementsSelectable={false}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodesChange={(changes) => {
          for (const ch of changes)
            if (ch.type === "dimensions" && ch.dimensions) {
              const { width, height } = ch.dimensions;
              setSizes((s) =>
                s[ch.id]?.width === width && s[ch.id]?.height === height
                  ? s
                  : { ...s, [ch.id]: { width, height } },
              );
            }
        }}
        onNodeClick={(e, node) => {
          if (e.shiftKey)
            onSelect(
              selected.includes(node.id)
                ? selected.filter((id) => id !== node.id)
                : [...selected, node.id],
            );
          else
            onSelect(
              selected.length === 1 && selected[0] === node.id ? [] : [node.id],
            );
        }}
        onPaneClick={() => onSelect([])}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-line-strong)" gap={22} />
        <Controls
          showInteractive={false}
          // its own fit runs React Flow's fitView as well, queued until after
          // ours: that framed the whole tree at an unreadable zoom
          showFitView={false}
          position="top-left"
        >
          <ControlButton
            onClick={() => {
              void frameWhole();
              // you have looked at the whole tree: nothing on it is new now
              setSeen(new Set(Object.keys(map.nodes)));
            }}
            title="Fit: the question and what is right under it"
            aria-label="Fit"
          >
            <svg viewBox="0 0 32 30" aria-hidden>
              <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
            </svg>
          </ControlButton>
        </Controls>
      </ReactFlow>
      {fresh.length > 0 && (
        // beside the zoom buttons, in the corner a card is least often in
        <button
          onClick={showNew}
          title="Frame the nodes Claude added since you last looked"
          className="absolute left-14 top-3 z-10 rounded-full bg-primary px-3 py-1 text-xs font-medium text-on-primary shadow-md hover:bg-primary-strong"
        >
          {fresh.length} new ▸
        </button>
      )}
      {(above.length > 0 || below.length > 0) && (
        // bottom left, beside the message box
        <div className="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-1">
          {above.length > 0 && (
            <button
              onClick={() => pan(-1)}
              className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-body shadow-md ring-1 ring-line hover:text-ink"
            >
              ▴ {above.length} more above
            </button>
          )}
          {below.length > 0 && (
            <button
              onClick={() => pan(1)}
              className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-body shadow-md ring-1 ring-line hover:text-ink"
            >
              ▾ {below.length} more below
            </button>
          )}
        </div>
      )}
    </>
  );
}
