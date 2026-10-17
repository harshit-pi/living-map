// The map of nodes: applying the model's ops, reading the map back, and the
// moves only you can make (choosing an option).

import {
  cleanSpecWithAnswers,
  elementsOf,
  hideGiveaways,
  keepFilled,
  revealBlank,
} from "./diagram.ts";
import { addMove, cleanScene, newPlay } from "./scene.ts";
import {
  own,
  safeId,
  type BlankAnswer,
  type Canvas,
  type Raw,
} from "./types.ts";
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

// A new node, cleaned as an add op is: a kind and status it may have, a
// parent that is on the map (else the root), titles cut to length. Shared
// with plugins that create nodes of their own (Explore's wants), so their
// nodes are the same shape as the model's.
export function makeNode(
  nodes: Record<string, MapNode>,
  f: {
    id: string;
    parent?: unknown;
    kind?: unknown;
    title?: unknown;
    summary?: unknown;
    detail?: unknown;
    status?: unknown;
    by?: "claude" | "you";
  },
  now = Date.now(),
): MapNode {
  const kind: Kind = KINDS.has(f.kind as Kind) ? (f.kind as Kind) : "fact";
  const parent =
    f.parent && own(nodes, String(f.parent))
      ? String(f.parent)
      : (Object.values(nodes).find((x) => !x.parent)?.id ?? null);
  const node: MapNode = {
    id: f.id,
    parent,
    kind,
    title: String(f.title ?? f.id).slice(0, 80),
    summary: String(f.summary ?? "").slice(0, 220),
    detail: typeof f.detail === "string" ? f.detail : "",
    status: STATUS[kind].includes(f.status as Status)
      ? (f.status as Status)
      : STATUS[kind][0],
    by: f.by ?? "claude",
    updatedAt: now,
    order: Object.keys(nodes).length,
    fresh: true,
  };
  nodes[f.id] = node;
  return node;
}

export function removeTree(nodes: Record<string, MapNode>, id: string) {
  for (const n of Object.values(nodes))
    if (n.parent === id) removeTree(nodes, n.id);
  delete nodes[id];
}

// Apply ops to a map. `scope` (a node id) limits changes to that node's
// subtree, which is how a side thread stays on its node: a scoped move may not
// redraw the topic diagram, judge blanks, or touch another step's scene, and if
// its node is gone it changes nothing.
export function applyOps(
  map: Canvas,
  ops: Raw[],
  {
    scope = null as string | null,
    // a scoped move may still judge the topic diagram's blanks (Show answer)
    judge = false,
    // a plugin's handler for ops core does not know (null: not its op either)
    extra = undefined as ((op: Raw) => number | null) | undefined,
    // nothing on the map may be removed or reworded (a mode switch: what you
    // explored stays, and reads the same when you switch back)
    keep = false,
    // nodes you made, chose or settled are yours: the model may not change or
    // remove them (a plugin opts in; Explore does)
    keepYours = false,
    now = Date.now(),
  } = {},
): number {
  const nodes = map.nodes;
  if (scope && !own(nodes, scope)) return 0;
  const inScope = () => (scope ? subtree(nodes, scope) : null);
  let changed = 0;
  for (const op of ops ?? []) {
    if (op?.op === "diagram") {
      if (scope) continue;
      const cleaned = cleanSpecWithAnswers(op.spec);
      if (cleaned) {
        const spec = cleaned.diagram;
        keepFilled(spec, map.fills ?? {});
        // each blank still open keeps its accepted answers: new ones if the
        // redraw sent them, the ones it had otherwise
        const answers: Record<string, BlankAnswer> = {};
        for (const el of elementsOf(spec)) {
          if (!el.blank) continue;
          const a = own(cleaned.answers, el.id) ?? own(map.answers, el.id);
          if (a) answers[el.id] = a;
        }
        map.answers = answers;
        hideGiveaways(spec, answers);
        map.diagram = spec;
        map.diagramAt = now;
        changed++;
      }
      continue;
    }
    if (op?.op === "scene" || op?.op === "move") {
      // a move with no step is not a scene's: a plugin may own it (Explore
      // files a node under another parent with it); otherwise it is ignored
      if (op.op === "move" && op.step === undefined) {
        if (extra) changed += extra(op) ?? 0;
        continue;
      }
      const step = String(op.step ?? "");
      if (!safeId(step) || !own(nodes, step)) continue;
      if (scope && !inScope()?.has(step)) continue;
      if (op.op === "move") {
        if (addMove(own(map.scenes, step), op)) changed++;
        continue;
      }
      const scene = cleanScene(op.spec);
      if (scene) {
        map.scenes ??= {};
        map.play ??= {};
        map.scenes[step] = scene;
        map.play[step] = newPlay();
        changed++;
      }
      continue;
    }
    if (op?.op === "judge") {
      const id = String(op.id ?? "");
      if ((scope && !judge) || !safeId(id)) continue;
      map.fills ??= {};
      const fill = own(map.fills, id) ?? { text: "", state: "pending" };
      fill.state = op.state === "right" ? "right" : "wrong";
      if (fill.state === "right" && op.label) {
        fill.text = String(op.label);
        revealBlank(map.diagram, id, String(op.label));
      }
      map.fills[id] = fill;
      changed++;
      continue;
    }
    if (
      extra &&
      op?.op !== "add" &&
      op?.op !== "update" &&
      op?.op !== "remove"
    ) {
      const n = extra(op);
      if (n !== null) {
        changed += n;
        continue;
      }
    }
    const id = String(op?.id ?? "").trim();
    if (!safeId(id)) continue;
    const allowed = inScope();
    const cur = own(nodes, id);
    if (keepYours && cur?.by === "you") {
      // yours stays as you left it; only its explanation, written when you
      // open it, may still arrive
      if (
        op.op === "update" &&
        typeof op.detail === "string" &&
        (!allowed || allowed.has(id))
      ) {
        cur.detail = op.detail;
        changed++;
      }
      continue;
    }
    if (op.op === "remove") {
      // the root holds the whole map: it is never removed
      if (
        !keep &&
        cur &&
        cur.parent !== null &&
        (!allowed || (allowed.has(id) && id !== scope))
      ) {
        removeTree(nodes, id);
        changed++;
      }
      continue;
    }
    if (op.op === "add" && !cur) {
      let parent: string | null =
        op.parent && own(nodes, String(op.parent)) ? String(op.parent) : null;
      if (!parent)
        parent = Object.values(nodes).find((x) => !x.parent)?.id ?? null;
      if (allowed && scope && !allowed.has(parent ?? "")) parent = scope; // a thread adds under its own node
      makeNode(
        nodes,
        {
          id,
          parent,
          kind: op.kind,
          title: op.title,
          summary: op.summary,
          detail: op.detail,
          status: op.status,
        },
        now,
      );
      changed++;
    } else if (cur) {
      if (allowed && !allowed.has(id)) continue;
      for (const k of ["title", "summary", "detail"] as const)
        if (typeof op[k] === "string" && !(keep && k !== "detail"))
          cur[k] = op[k];
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
  }
  return q ?? null;
}
