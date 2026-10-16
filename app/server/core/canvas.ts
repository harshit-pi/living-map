// The map of nodes: applying the model's ops, reading the map back, and the
// moves only you can make (choosing an option).

import { cleanSpec, keepFilled, revealBlank } from "./diagram.ts";
import { addMove, cleanScene, newPlay } from "./scene.ts";
import type { Canvas, Raw } from "./types.ts";
import type { Kind, MapNode, Status } from "../../shared/model.ts";

export const KINDS = new Set<Kind>(["question", "option", "fact"]);
export const STATUS: Record<Kind, Status[]> = {
  question: ["open", "answered"],
  option: ["proposed", "chosen", "dropped"],
  fact: ["info"],
};

export function subtree(
  nodes: Record<string, MapNode>,
  id: string,
): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of Object.values(nodes))
      if (n.parent && out.has(n.parent) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
  }
  return out;
}

export function pathTo(nodes: Record<string, MapNode>, id: string): MapNode[] {
  const path: MapNode[] = [];
  for (
    let n: MapNode | undefined = nodes[id];
    n;
    n = n.parent ? nodes[n.parent] : undefined
  )
    path.unshift(n);
  return path;
}

export function removeTree(nodes: Record<string, MapNode>, id: string) {
  for (const n of Object.values(nodes))
    if (n.parent === id) removeTree(nodes, n.id);
  delete nodes[id];
}

// Apply ops to a map. `scope` (a node id) limits node changes to that node's
// subtree, which is how a side thread stays on its node.
export function applyOps(
  map: Canvas,
  ops: Raw[],
  { scope = null as string | null, now = Date.now() } = {},
): number {
  const nodes = map.nodes;
  let changed = 0;
  const allowed = () => (scope && nodes[scope] ? subtree(nodes, scope) : null);
  for (const op of ops ?? []) {
    if (op?.op === "diagram") {
      const spec = cleanSpec(op.spec);
      if (spec) {
        keepFilled(spec, map.fills ?? {});
        map.diagram = spec;
        map.diagramAt = now;
        changed++;
      }
      continue;
    }
    if (op?.op === "scene") {
      const step = String(op.step ?? "");
      const scene = cleanScene(op.spec);
      if (scene && nodes[step]) {
        map.scenes ??= {};
        map.play ??= {};
        map.scenes[step] = scene;
        map.play[step] = newPlay();
        changed++;
      }
      continue;
    }
    if (op?.op === "move") {
      if (addMove(map.scenes?.[String(op.step ?? "")], op)) changed++;
      continue;
    }
    if (op?.op === "judge") {
      const id = String(op.id ?? "");
      if (!id) continue;
      map.fills ??= {};
      const fill = map.fills[id] ?? { text: "", state: "pending" };
      fill.state = op.state === "right" ? "right" : "wrong";
      if (fill.state === "right" && op.label) {
        fill.text = String(op.label);
        revealBlank(map.diagram, id, String(op.label));
      }
      map.fills[id] = fill;
      changed++;
      continue;
    }
    const id = String(op?.id ?? "").trim();
    if (!id) continue;
    const inScope = allowed();
    if (op.op === "remove") {
      if (nodes[id] && (!inScope || (inScope.has(id) && id !== scope))) {
        removeTree(nodes, id);
        changed++;
      }
      continue;
    }
    const cur = nodes[id];
    if (op.op === "add" && !cur) {
      const kind: Kind = KINDS.has(op.kind) ? op.kind : "fact";
      let parent: string | null =
        op.parent && nodes[op.parent] ? op.parent : null;
      if (!parent)
        parent = Object.values(nodes).find((x) => !x.parent)?.id ?? null;
      if (inScope && scope && !inScope.has(parent ?? "")) parent = scope; // a thread adds under its own node
      nodes[id] = {
        id,
        parent,
        kind,
        title: String(op.title ?? id).slice(0, 80),
        summary: String(op.summary ?? "").slice(0, 220),
        detail: typeof op.detail === "string" ? op.detail : "",
        status: STATUS[kind].includes(op.status) ? op.status : STATUS[kind][0],
        by: "claude",
        updatedAt: now,
        order: Object.keys(nodes).length,
        fresh: true,
      };
      changed++;
    } else if (cur) {
      if (inScope && !inScope.has(id)) continue;
      for (const k of ["title", "summary", "detail"] as const)
        if (typeof op[k] === "string") cur[k] = op[k];
      // only you choose
      if (
        op.status &&
        STATUS[cur.kind].includes(op.status) &&
        !(op.status === "chosen" && cur.status !== "chosen")
      )
        cur.status = op.status;
      cur.updatedAt = now;
      cur.fresh = true;
      changed++;
    }
  }
  return changed;
}

// The map as the model reads it: one line per node, indented by depth.
export function outline(nodes: Record<string, MapNode>): string {
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of Object.values(nodes)
      .filter((x) => x.parent === parent)
      .sort((a, b) => a.order - b.order)) {
      lines.push(
        `${"  ".repeat(depth)}- [${n.id}] ${n.kind} · ${n.status}${n.revealed ? " · answer shown" : ""}${n.dropped ? " · set aside by user" : ""}${n.by === "you" ? " (by user)" : ""} · ${n.title} — ${n.summary}${n.detail ? " (has detail)" : ""}`,
      );
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n") || "(empty)";
}

// Choosing an option sets its siblings aside and answers the question above it.
export function choose(
  nodes: Record<string, MapNode>,
  id: string,
): MapNode | null {
  const node = nodes[id];
  if (!node || node.kind !== "option") return null;
  for (const s of Object.values(nodes)) {
    if (
      s.parent === node.parent &&
      s.kind === "option" &&
      s.id !== id &&
      s.status !== "dropped"
    ) {
      s.status = "dropped";
      s.by = "you";
    }
  }
  node.status = "chosen";
  node.by = "you";
  const q = node.parent ? nodes[node.parent] : undefined;
  if (q && q.kind === "question") {
    q.status = "answered";
    q.summary = `Chosen: ${node.title}`;
  }
  return q ?? null;
}
