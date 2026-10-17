import { Handle, Position, type NodeProps } from "@xyflow/react";

import { lookOf } from "./look.ts";
import type { MapNode, Purpose } from "../../shared/model.ts";
import { NODE_W } from "../lib/layout.ts";

export type CardData = {
  node: MapNode;
  purpose: Purpose;
  threads: number;
  working: boolean;
  // a plugin's own word for the card's kind (Explore's "possible cause")
  tag?: string;
};

export function NodeCard({ data, selected }: NodeProps) {
  const { node: n, purpose, threads, working, tag } = data as CardData;
  const l = lookOf(n, purpose);
  const recommended = n.summary.startsWith("Recommended:");
  const gone = n.dropped || n.status === "dropped";
  return (
    <div
      style={{ width: NODE_W }}
      className={`rounded-xl px-3 py-2.5 shadow-xs ${l.box} ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-canvas" : ""} ${n.fresh ? "fresh" : ""} ${working ? "is-working" : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide ${l.tagCls}`}
        >
          {tag ?? l.tag}
        </span>
        <span className="flex items-center gap-1">
          {recommended && !gone && (
            <span className="rounded-full bg-primary-soft px-1.5 text-[10px] font-semibold text-primary-strong">
              ★ recommended
            </span>
          )}
          {n.detail && (
            <span className="text-[10px] text-faint" title="Has an explanation">
              ≡
            </span>
          )}
          {threads > 0 && (
            <span
              className="rounded-full bg-panel px-1.5 text-[10px] text-muted ring-1 ring-line"
              title="Side threads"
            >
              💬 {threads}
            </span>
          )}
        </span>
      </div>
      <div
        className={`mt-0.5 text-[15px] font-semibold leading-snug ${l.title}`}
      >
        {n.title}
      </div>
      {n.summary && (
        <div className="mt-0.5 whitespace-pre-line text-[13px] leading-snug text-body">
          {n.summary.replace(/^Recommended:\s*/, "")}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
