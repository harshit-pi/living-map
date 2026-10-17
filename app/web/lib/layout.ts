import type { MapNode } from "../../shared/model.ts";

// a card's width, on Explore's Tree and in Learn
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
