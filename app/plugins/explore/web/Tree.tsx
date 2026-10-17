import {
  Background,
  Controls,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { exploreView, tagOf } from "./view.ts";
import type { MapDoc } from "../../../shared/model.ts";
import { NodeCard } from "../../../web/components/NodeCard.tsx";
import { layout, setAside } from "../../../web/lib/layout.ts";

// the floating message box, and Claude's reply above it, cover the bottom of
// the canvas: frame above both
const FRAME = {
  top: "24px",
  left: "24px",
  right: "24px",
  bottom: "200px",
} as const;

const nodeTypes = { map: NodeCard };

// the smallest zoom a card can still be read at: a tree too big to fit at
// it opens at this zoom on its root (left edge, middle of the room above the
// message box), and you pan for the rest
const READABLE = 0.7;
const PAD = 24;
const BELOW = 200;
// the whole tree, above the message box: on first load and from the fit button
const WHOLE = { padding: FRAME, maxZoom: 1, minZoom: READABLE };
// the node panel (420px wide, 12px from the edge) covers the right of the
// canvas: new work is framed to its left, unless the canvas is too narrow
const PANEL_W = 420 + 12;

// Explore's Tree tab: the question as a left-to-right tree of options and
// facts. The app owns the selection: a click selects one node, Shift-click
// adds or removes, a click on empty canvas clears.
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
        ? { ...FRAME, right: `${PANEL_W + 24}px` as const }
        : FRAME,
    [panelOpen, width],
  );
  // read when a fit runs: the panel opening is no reason to frame again
  const framing = useRef(frame);
  useEffect(() => {
    framing.current = frame;
  }, [frame]);
  const visible = useMemo(
    () =>
      Object.values(map.nodes).filter(
        (n) => showDropped || !setAside(map.nodes, n.id),
      ),
    [map, showDropped],
  );
  const laid = useMemo(() => layout(visible), [visible]);
  const threads = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of Object.values(map.threads ?? {}))
      c[t.nodeId] = (c[t.nodeId] ?? 0) + 1;
    return c;
  }, [map.threads]);
  // each card's measured size, kept on the nodes: the layout hands over new
  // nodes on every change, and one without a size is hidden until React Flow
  // measures it again, which a card whose size did not change may never get,
  // leaving the tree blank but for the newest card
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const view = exploreView(map);
  const nodes = useMemo(
    () =>
      laid.nodes.map((n) => ({
        ...n,
        measured: sizes[n.id],
        selected: selected.includes(n.id),
        data: {
          ...n.data,
          purpose: map.purpose,
          threads: threads[n.id] ?? 0,
          working: n.id === workingId,
          tag: tagOf(view, map.nodes, map.nodes[n.id]),
        },
      })),
    [laid, sizes, selected, map.purpose, map.nodes, view, threads, workingId],
  );
  const { fitView, getViewport, setViewport } = useReactFlow();

  // The whole tree, or, when it cannot be read whole, its root and what is
  // next to it: a fit at the smallest readable zoom would frame the middle
  // of the bounds, which on a lopsided tree is no card in particular.
  const frameWhole = async () => {
    await fitView({ ...WHOLE, duration: 300 });
    const root = laid.nodes.find((n) => !map.nodes[n.id]?.parent);
    if (!root || getViewport().zoom > READABLE + 0.001) return;
    const h = sizes[root.id]?.height ?? 120;
    const room = Math.max(height - BELOW, 200);
    await setViewport(
      {
        x: PAD - root.position.x * READABLE,
        y: PAD + (room - PAD) / 2 - (root.position.y + h / 2) * READABLE,
        zoom: READABLE,
      },
      { duration: 200 },
    );
  };

  // The camera holds still: it frames the whole tree when the tree first
  // opens and from the fit button, never on its own as Claude adds nodes, so
  // what you were reading stays where you left it. New nodes light up a pill
  // instead, and the pill frames them.
  // the layout as it is when the fit runs, not when it was asked for
  const frameNow = useEffectEvent(() => void frameWhole());
  // once the cards are measured, or there is nothing to frame yet
  const measured = useNodesInitialized();
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
    fitted.current = fitKey;
    requestAnimationFrame(() => frameNow());
  }, [measured, fitKey]);
  // the nodes you have been shown: every node the map had when the tree
  // opened, those of the first move (framed as they came), and those the
  // pill framed since
  const [seen, setSeen] = useState(() => new Set(Object.keys(map.nodes)));
  if (growing && seen.size !== Object.keys(map.nodes).length)
    setSeen(new Set(Object.keys(map.nodes)));
  // The layout re-centres a parent on its children as they change, so the
  // card you are reading would jump: the camera follows it instead (the
  // card you selected, else the root), so it stays where it was on screen.
  const anchorAt = useRef<{ id: string; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const id =
      selected.find((x) => laid.nodes.some((n) => n.id === x)) ??
      laid.nodes.find((n) => !map.nodes[n.id]?.parent)?.id;
    const now = laid.nodes.find((n) => n.id === id)?.position;
    const was = anchorAt.current;
    if (
      !growing &&
      id &&
      now &&
      was?.id === id &&
      (was.x !== now.x || was.y !== now.y)
    ) {
      const v = getViewport();
      void setViewport({
        x: v.x - (now.x - was.x) * v.zoom,
        y: v.y - (now.y - was.y) * v.zoom,
        zoom: v.zoom,
      });
    }
    anchorAt.current = id && now ? { id, ...now } : null;
  }, [laid, selected, map.nodes, growing, getViewport, setViewport]);
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
        padding: framing.current,
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
        await setViewport({ ...v, y: PAD - top * v.zoom }, { duration: 200 });
    })();
    setSeen(new Set([...seen, ...Object.keys(map.nodes)]));
  };

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={laid.edges}
        nodeTypes={nodeTypes}
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
        fitView
        fitViewOptions={{ maxZoom: 1, minZoom: 0.7, padding: FRAME }}
      >
        <Background color="var(--color-line-strong)" gap={22} />
        <Controls
          showInteractive={false}
          position="top-left"
          onFitView={() => void frameWhole()}
        />
      </ReactFlow>
      {fresh.length > 0 && (
        <button
          onClick={showNew}
          title="Frame the nodes Claude added since you last looked"
          className="absolute right-4 top-3 z-10 rounded-full bg-primary px-3 py-1 text-xs font-medium text-on-primary shadow-md hover:bg-primary-strong"
          style={
            panelOpen && width > PANEL_W * 2
              ? { right: PANEL_W + 16 }
              : undefined
          }
        >
          {fresh.length} new ▸
        </button>
      )}
    </>
  );
}
