import { Handle, Position, type NodeProps } from "@xyflow/react";

import { NODE_H, NODE_W } from "./layout.ts";
import { lookOf } from "./look.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

// What a node on the map is drawn from: its item (none for the chat's
// root), how the lens and search left it, and a folded topic's counts.
export type ItemData = {
  item: LedgerItem | null;
  title: string;
  folded: boolean;
  hasKids: boolean;
  counts: string | null; // "2 waiting · 5 settled", on a folded topic
  lensCount: number; // matches inside a fold, while a lens is on
  lit: boolean;
  dim: boolean;
  selected: boolean;
  isNew: boolean;
};

const hidden = { opacity: 0, pointerEvents: "none" as const };

const ring = (d: ItemData) =>
  d.selected
    ? "ring-2 ring-ink ring-offset-2 ring-offset-canvas"
    : d.lit
      ? "ring-2 ring-primary ring-offset-2 ring-offset-canvas"
      : "";

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} style={hidden} />
      <Handle type="source" position={Position.Right} style={hidden} />
    </>
  );
}

export function ItemNode({ data }: NodeProps) {
  const d = data as ItemData;
  const i = d.item;
  if (!i) return <RootNode d={d} />;
  const look = lookOf(i);
  const topic = i.type === "topic";
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={`relative flex items-center gap-2 rounded-lg px-2.5 transition-opacity ${look.box} ${ring(d)} ${d.dim ? "opacity-25" : ""}`}
      title={`${i.title}: ${look.tag}`}
    >
      <Handles />
      {topic ? (
        <span
          aria-hidden
          className="w-3 shrink-0 text-center text-[14px] text-muted"
        >
          {d.hasKids ? (d.folded ? "▸" : "▾") : ""}
        </span>
      ) : (
        <span
          aria-hidden
          className={`w-3 shrink-0 text-center text-[12px] ${look.title}`}
        >
          {look.glyph}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div
          data-content
          className={`text-[12.5px] leading-[15px] ${topic && d.folded ? "line-clamp-1" : "line-clamp-2"} ${look.title}`}
        >
          {i.title}
        </div>
        {topic && d.folded && (
          <div className="truncate text-[10.5px] leading-[13px] text-muted">
            {d.lensCount > 0 ? (
              <span className="font-medium text-primary-strong">
                {d.lensCount} inside ·{" "}
              </span>
            ) : null}
            {d.counts}
          </div>
        )}
      </div>
      {!!i.proposals && (
        <span
          title={`A side chat proposed ${i.proposals === 1 ? "a change" : `${i.proposals} changes`} here; open it to apply or leave`}
          className="absolute -top-1.5 -left-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-hint px-1 text-[10px] font-medium text-on-primary ring-2 ring-canvas"
        >
          {i.proposals}
        </span>
      )}
      {d.isNew && (
        <span
          title="New since you looked"
          className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-canvas"
        />
      )}
    </div>
  );
}

function RootNode({ d }: { d: ItemData }) {
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={`flex items-center justify-center rounded-full border-2 border-ink bg-surface px-4 ${d.dim ? "opacity-60" : ""}`}
    >
      <Handles />
      <div
        data-content
        className="line-clamp-2 text-center text-[12.5px] leading-[15px] font-semibold text-ink"
      >
        {d.title}
      </div>
    </div>
  );
}
