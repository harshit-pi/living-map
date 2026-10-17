import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

import type { MapNode } from "../../shared/model.ts";

export const NODE_W = 248;

// Set aside, or under something set aside: hidden together when set-aside
// nodes are hidden, so no child is left on the canvas without its parent.
export function setAside(
  nodes: Record<string, MapNode>,
  id: string | null,
): boolean {
  for (let n = id ? nodes[id] : undefined, i = 0; n && i < 100; i++) {
    if (n.dropped || n.status === "dropped") return true;
    n = n.parent ? nodes[n.parent] : undefined;
  }
  return false;
}

// Rough height from text, so the tree lays out before the browser measures.
function heightOf(n: MapNode) {
  const lines = (s: string, per: number) =>
    Math.max(1, Math.ceil(s.length / per));
  return (
    54 + lines(n.title, 22) * 21 + (n.summary ? lines(n.summary, 30) * 18 : 0)
  );
}

export function layout(nodes: MapNode[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  // left to right: options stack down the page, so text stays readable in a narrow canvas
  g.setGraph({
    rankdir: "LR",
    nodesep: 14,
    ranksep: 64,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((n) => n.id));
  const ordered = [...nodes].sort((a, b) => a.order - b.order);
  for (const n of ordered)
    g.setNode(n.id, { width: NODE_W, height: heightOf(n) });
  for (const n of ordered)
    if (n.parent && ids.has(n.parent)) g.setEdge(n.parent, n.id);
  dagre.layout(g);
  return {
    nodes: ordered.map((n) => {
      const p = g.node(n.id);
      return {
        id: n.id,
        type: "map",
        position: { x: p.x - p.width / 2, y: p.y - p.height / 2 },
        data: { node: n },
      };
    }),
    edges: ordered
      .filter((n) => n.parent && ids.has(n.parent))
      .map((n) => ({
        id: `${n.parent}-${n.id}`,
        source: n.parent!,
        target: n.id,
        type: "smoothstep",
        style: {
          stroke:
            n.status === "dropped" || n.dropped
              ? "var(--color-line-strong)"
              : n.status === "chosen"
                ? "var(--color-success)"
                : "var(--color-faint)",
          strokeWidth: n.status === "chosen" ? 2 : 1.2,
        },
      })),
  };
}
