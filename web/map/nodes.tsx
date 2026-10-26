import { Handle, Position, type NodeProps } from "@xyflow/react";

import { Glyph } from "./Glyph.tsx";
import { NARROW, type Size } from "./layout.ts";
import type { Lens } from "./lens.ts";
import { LENS_LOOK, lookOf } from "./look.ts";
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
  lens: Lens | null; // the lens lighting the map, if it isn't a search
  dim: boolean;
  selected: boolean;
  isNew: boolean;
  now: boolean; // the topic the chat is on, marked with a dot
  size: Size;
};

// the narrow size is a smaller box with a third line of title, so a title
// says as much in less width
const textOf = (d: ItemData) =>
  d.size === NARROW
    ? { title: "text-[12px] leading-[14px]", lines: 3, pad: "gap-1.5 px-2" }
    : { title: "text-[12.5px] leading-[15px]", lines: 3, pad: "gap-2 px-3" };
const CLAMP = ["", "line-clamp-1", "line-clamp-2", "line-clamp-3"];

const hidden = { opacity: 0, pointerEvents: "none" as const };

const ring = (d: ItemData) =>
  d.selected
    ? "ring-2 ring-ink ring-offset-2 ring-offset-canvas"
    : d.lit && !d.lens
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
  const text = textOf(d);
  // a topic keeps a line for what it holds
  const lines = topic && d.counts ? text.lines - 1 : text.lines;
  // a lens colours the boxes it lights
  const box = d.lit && d.lens ? LENS_LOOK[d.lens].box : look.box;
  return (
    <div
      style={{ width: d.size.w, height: d.size.h }}
      className={`relative flex items-center ${text.pad} rounded-lg transition-opacity ${box} ${ring(d)} ${d.dim ? "opacity-25" : ""}`}
      title={`${i.title}: ${look.tag}`}
    >
      <Handles />
      {topic ? (
        <span
          aria-hidden
          className="flex w-3 shrink-0 justify-center text-muted"
        >
          {d.hasKids && (
            // a thin chevron: right when folded, down when open
            <svg
              viewBox="0 0 16 16"
              className={`h-3 w-3 transition-transform ${d.folded ? "" : "rotate-90"}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          )}
        </span>
      ) : (
        <span
          aria-hidden
          className={`w-3.5 shrink-0 text-center text-[12px] ${look.mark}`}
        >
          <Glyph g={look.glyph} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div
          data-content
          // a long name with no spaces breaks instead of running off the box
          className={`${text.title} ${CLAMP[lines]} wrap-break-word ${look.title}`}
        >
          {topic && d.now && (
            <span
              title="The topic the chat is on"
              className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary align-[1px]"
            />
          )}
          {i.title}
        </div>
        {topic && d.counts && (
          <div className="truncate text-[10.5px] leading-[13px] text-muted">
            {d.lensCount > 0 ? (
              <span
                className={`font-medium ${d.lens ? LENS_LOOK[d.lens].text : "text-primary-strong"}`}
              >
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
  const text = textOf(d);
  return (
    <div
      style={{ width: d.size.w, height: d.size.h }}
      className={`flex items-center justify-center rounded-full border border-line-strong bg-surface ${d.size === NARROW ? "px-3" : "px-4"} ${d.dim ? "opacity-60" : ""}`}
    >
      <Handles />
      <div
        data-content
        className={`${CLAMP[text.lines]} text-center ${text.title} font-semibold text-ink`}
      >
        {d.title}
      </div>
    </div>
  );
}
