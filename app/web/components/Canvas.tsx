import { Background, Controls, ReactFlow, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";

import { NodeCard } from "./NodeCard.tsx";
import type { MapDoc } from "../../shared/model.ts";
import { layout, setAside } from "../lib/layout.ts";

// the floating message box covers the bottom of the canvas: frame above it
const FRAME = {
  top: "24px",
  left: "24px",
  right: "24px",
  bottom: "140px",
} as const;

const nodeTypes = { map: NodeCard };

// The app owns the selection: a click selects one node, Shift-click adds or
// removes, a click on empty canvas clears.
export function Canvas({
  map,
  showDropped,
  selected,
  busy,
  workingId,
  onSelect,
}: {
  map: MapDoc;
  showDropped: boolean;
  selected: string[];
  busy: boolean;
  workingId: string | null;
  onSelect: (ids: string[]) => void;
}) {
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
  const nodes = useMemo(
    () =>
      laid.nodes.map((n) => ({
        ...n,
        selected: selected.includes(n.id),
        data: {
          ...n.data,
          purpose: map.purpose,
          threads: threads[n.id] ?? 0,
          working: n.id === workingId,
        },
      })),
    [laid, selected, map.purpose, threads, workingId],
  );
  const { fitView } = useReactFlow();
  const seen = useRef<Set<string> | null>(null);

  // Follow the work: when nodes appear, frame the new ones with their parent at
  // a readable zoom; on first load, frame the whole tree. Otherwise leave the
  // view where the user put it.
  useEffect(() => {
    const ids = new Set(laid.nodes.map((n) => n.id));
    const before = seen.current;
    seen.current = ids;
    if (!before) {
      requestAnimationFrame(() => {
        void fitView({
          padding: FRAME,
          duration: 300,
          maxZoom: 1,
          minZoom: 0.45,
        });
      });
      return;
    }
    const added = [...ids].filter((id) => !before.has(id));
    if (!added.length) return;
    const parents = added
      .map((id) => map.nodes[id]?.parent)
      .filter((p): p is string => !!p && ids.has(p));
    const focus = [...new Set([...added, ...parents])].map((id) => ({ id }));
    // wait for the new cards to be measured, or there is nothing to frame yet
    const t = setTimeout(() => {
      void fitView({
        nodes: focus,
        padding: FRAME,
        duration: 500,
        maxZoom: 1,
        minZoom: 0.55,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [laid, map.nodes, fitView]);

  // When Claude finishes a move, frame the whole new branch with its parent,
  // zooming out further if the branch is big, so nothing is left cut off.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const fresh = Object.values(map.nodes).filter(
        (n) => n.fresh && laid.nodes.some((l) => l.id === n.id),
      );
      if (fresh.length) {
        const ids = new Set(fresh.map((n) => n.id));
        for (const n of fresh) if (n.parent) ids.add(n.parent);
        const t = setTimeout(() => {
          void fitView({
            nodes: [...ids].map((id) => ({ id })),
            padding: FRAME,
            duration: 500,
            maxZoom: 1,
            minZoom: 0.35,
          });
        }, 300);
        wasBusy.current = busy;
        return () => clearTimeout(t);
      }
    }
    wasBusy.current = busy;
  }, [busy, map.nodes, laid, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={laid.edges}
      nodeTypes={nodeTypes}
      elementsSelectable={false}
      nodesDraggable={false}
      nodesConnectable={false}
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
      <Controls showInteractive={false} position="top-left" />
    </ReactFlow>
  );
}
