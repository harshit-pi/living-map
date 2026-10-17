import {
  Background,
  Controls,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";

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

// the whole tree, above the message box: on first load and from the fit button
const WHOLE = { padding: FRAME, maxZoom: 1, minZoom: 0.2 };
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
  panelOpen,
  onSelect,
}: {
  map: MapDoc;
  showDropped: boolean;
  selected: string[];
  workingId: string | null;
  panelOpen: boolean;
  onSelect: (ids: string[]) => void;
}) {
  const width = useStore((s) => s.width);
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
        },
      })),
    [laid, sizes, selected, map.purpose, threads, workingId],
  );
  const { fitView } = useReactFlow();

  // The camera holds still: it frames the whole tree when the tree first
  // opens and from the fit button, never on its own as Claude adds nodes, so
  // what you were reading stays where you left it. New nodes light up a pill
  // instead, and the pill frames them.
  const fitted = useRef(false);
  // once the cards are measured, or there is nothing to frame yet
  const measured = useNodesInitialized();
  useEffect(() => {
    if (fitted.current || !measured) return;
    fitted.current = true;
    requestAnimationFrame(() => {
      void fitView({ ...WHOLE, duration: 300 });
    });
  }, [measured, fitView]);
  // the nodes you have been shown: every node the map had when the tree
  // opened, and those the pill framed since
  const [seen, setSeen] = useState(() => new Set(Object.keys(map.nodes)));
  const fresh = laid.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  const showNew = () => {
    const ids = new Set(fresh);
    for (const id of fresh) {
      const p = map.nodes[id]?.parent;
      if (p && laid.nodes.some((n) => n.id === p)) ids.add(p);
    }
    void fitView({
      nodes: [...ids].map((id) => ({ id })),
      padding: framing.current,
      duration: 500,
      maxZoom: 1,
      minZoom: 0.35,
    });
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
          fitViewOptions={WHOLE}
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
