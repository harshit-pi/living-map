// Moving along a learning path: the steps are the root's question children, in order.

import type { MapDoc, MapNode } from "../../shared/model.ts";

function stepsOf(map: MapDoc, parent: string | null | undefined): MapNode[] {
  return Object.values(map.nodes)
    .filter((n) => n.parent === parent && n.kind === "question" && !n.dropped)
    .sort((a, b) => a.order - b.order);
}

// The first open step after the one in view, wrapping round; or the first open step.
export function nextOpenStep(map: MapDoc, id?: string): string | undefined {
  const root = Object.values(map.nodes).find((n) => !n.parent);
  const steps = stepsOf(map, root?.id);
  const from = id ? steps.findIndex((n) => n.id === id) + 1 : 0;
  return (
    [...steps.slice(from), ...steps.slice(0, from)].find(
      (n) => n.status === "open" && !n.revealed,
    )?.id ?? steps[from]?.id
  );
}

// The step after this one among its siblings, preferring an open one.
export function nextStep(map: MapDoc, id: string): string | undefined {
  const sibs = stepsOf(map, map.nodes[id]?.parent);
  const at = sibs.findIndex((n) => n.id === id);
  return (
    sibs.slice(at + 1).find((n) => n.status === "open")?.id ?? sibs[at + 1]?.id
  );
}
