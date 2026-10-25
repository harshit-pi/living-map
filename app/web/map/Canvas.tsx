import {
  Background,
  BaseEdge,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type Viewport,
} from "@xyflow/react";
import { useMemo } from "react";

import { ROOT, type Layout, type Size } from "./layout.ts";
import { countsOf, countsText, descendants } from "./lens.ts";
import { lookOf } from "./look.ts";
import { ItemNode, type ItemData } from "./nodes.tsx";
import type { LedgerItem } from "../../shared/ledger.ts";

const nodeTypes = { item: ItemNode };

// out of the parent's right side, down the gap between the columns, across
// into the child: every child of one parent shares that one vertical line
function Branch({
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  data,
}: EdgeProps) {
  const mid = sourceX + Number(data?.gap ?? 0) / 2;
  const path =
    Math.abs(targetY - sourceY) < 1
      ? `M ${sourceX} ${sourceY} H ${targetX}`
      : `M ${sourceX} ${sourceY} H ${mid} V ${targetY} H ${targetX}`;
  return <BaseEdge path={path} style={style} />;
}
const edgeTypes = { branch: Branch };

// what a screen reader says on a node; React Flow's own words speak of
// selecting, deleting and dragging, none of which the map does
const ARIA = {
  "node.a11yDescription.default": "Enter opens an item or folds a topic.",
  "node.a11yDescription.keyboardDisabled": "",
};

const LINE = "var(--color-line-strong)";
const LINK = "var(--color-faint)";

// The map drawn: one node per placed item at the layout's position, tree
// edges from parent to child, cross-links dashed. Nothing here decides a
// position; a lens or a search only lights and dims.
export function Canvas({
  title,
  items,
  laid,
  size,
  folded,
  lit,
  newIds,
  selected,
  initial,
  onNode,
  onPane,
  onUserMove,
  onMoveEnd,
}: {
  title: string;
  items: LedgerItem[];
  laid: Layout;
  size: Size;
  folded: (id: string) => boolean;
  // null: no lens or search on, nothing dims
  lit: ((i: LedgerItem) => boolean) | null;
  newIds: Set<string>;
  selected: string | null;
  initial: Viewport;
  onNode: (id: string) => void;
  onPane: () => void;
  onUserMove: () => void;
  onMoveEnd: (v: Viewport) => void;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const nodes = useMemo((): Node[] => {
    return laid.order.map((id) => {
      const p = laid.nodes.get(id)!;
      const item = id === ROOT ? null : (byId.get(id) ?? null);
      const isFolded = !!item && item.type === "topic" && folded(id);
      const under = isFolded ? descendants(items, id) : [];
      const data: ItemData = {
        item,
        title: item?.title ?? title,
        folded: isFolded,
        hasKids: item ? items.some((i) => i.parent === id) : true,
        counts: isFolded ? countsText(countsOf(under)) : null,
        lensCount: isFolded && lit ? under.filter(lit).length : 0,
        lit: !!item && !!lit && lit(item),
        dim:
          !!lit &&
          (!item ||
            !(
              lit(item) ||
              (isFolded && under.some(lit)) ||
              // a topic stays readable while what it holds is lit
              (item.type === "topic" && descendants(items, id).some(lit))
            )),
        selected: selected === id,
        isNew: newIds.has(id),
        size,
      };
      return {
        id,
        type: "item",
        position: { x: p.x, y: p.y },
        width: size.w,
        height: size.h,
        data,
        draggable: false,
        selectable: false,
        focusable: !!item,
        ...(item
          ? {
              ariaRole: "button" as const,
              ariaLabel: `${item.title}: ${lookOf(item).tag}`,
            }
          : {}),
        className:
          "rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      };
    });
  }, [laid, byId, items, title, folded, lit, selected, newIds, size]);

  const edges = useMemo((): Edge[] => {
    const dimmed = new Set(
      nodes.filter((n) => (n.data as ItemData).dim).map((n) => n.id),
    );
    const tree = laid.edges.map((e): Edge => ({
      id: `${e.from}>${e.to}`,
      source: e.from,
      target: e.to,
      type: "branch",
      data: { gap: size.col - size.w },
      style: {
        stroke: LINE,
        strokeWidth: 1.5,
        opacity: dimmed.has(e.to) ? 0.3 : 1,
      },
    }));
    const links = laid.links.map((l): Edge => ({
      id: `${l.from}~${l.to}`,
      source: l.from,
      target: l.to,
      type: "default",
      label: l.rel,
      labelStyle: { fill: "var(--color-muted)", fontSize: 10 },
      labelBgStyle: { fill: "var(--color-canvas)" },
      style: {
        stroke: LINK,
        strokeWidth: 1.25,
        strokeDasharray: "5 4",
        opacity: dimmed.has(l.from) && dimmed.has(l.to) ? 0.3 : 1,
      },
    }));
    return [...tree, ...links];
  }, [laid, nodes, size]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultViewport={initial}
      elementsSelectable={false}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, n) => {
        if (n.id !== ROOT) onNode(n.id);
      }}
      onPaneClick={onPane}
      // Enter or Space on a focused node does what a click does
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const el = e.target as HTMLElement;
        const id = el.classList.contains("react-flow__node")
          ? el.dataset.id
          : undefined;
        if (!id || id === ROOT) return;
        e.preventDefault();
        onNode(id);
      }}
      onMoveEnd={(_, v) => onMoveEnd(v)}
      // a move with an event behind it is yours (a drag, the wheel, a pinch);
      // the camera moving for Now or a step has none
      onMoveStart={(e) => {
        if (e) onUserMove();
      }}
      // the wheel pans; a pinch or Ctrl-wheel zooms
      panOnScroll
      zoomOnScroll={false}
      minZoom={0.2}
      maxZoom={1.6}
      edgesFocusable={false}
      deleteKeyCode={null}
      ariaLabelConfig={ARIA}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="var(--color-line-strong)" gap={22} />
    </ReactFlow>
  );
}
