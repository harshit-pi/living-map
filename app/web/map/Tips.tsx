import { useStore } from "@xyflow/react";

import { Glyph } from "./Glyph.tsx";
import { ROOT, type Layout, type Size } from "./layout.ts";
import { nextTip, TIPS, type TipId } from "./tips.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

const W = 240; // the tip's width
const GAP = 6;

// the tip's text, with its flag and boxes drawn like the map's
const withGlyphs = (text: string) =>
  text
    .split(/([⚑☐☑])/)
    .map((part, k) =>
      /^[⚑☐☑]$/.test(part) ? <Glyph key={k} g={part} /> : part,
    );

// One tip: a line and two ways out. Floating, it sits over the map beside
// what it explains; inline, it sits inside a card.
export function Tip({
  tip,
  floating = true,
  style,
  onDone,
  onOff,
}: {
  tip: TipId;
  floating?: boolean;
  style?: React.CSSProperties;
  onDone: () => void;
  onOff: () => void;
}) {
  return (
    <div
      role="note"
      style={style}
      className={
        floating
          ? "absolute z-20 rounded-lg bg-surface p-2.5 shadow-lg ring-1 ring-line-strong"
          : "mt-3 rounded-lg bg-panel p-2.5"
      }
    >
      <p className="text-[12.5px] leading-snug text-body">
        <span className="mr-1 font-medium text-primary-strong">Tip</span>
        {withGlyphs(TIPS[tip])}
      </p>
      <div className="mt-2 flex items-center justify-end gap-1">
        <button
          onClick={onOff}
          className="px-1.5 py-0.5 text-[12px] text-muted hover:text-ink"
        >
          No more tips
        </button>
        <button
          onClick={onDone}
          className="rounded-md border border-line-strong px-2 py-0.5 text-[12px] text-ink hover:bg-panel"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

// The map's next tip, beside the first box of its kind that is fully on
// screen (or under the lens row). It follows the camera, so it rides along
// while you pan, and gives way to the next once its box leaves the screen.
export function MapTips({
  laid,
  byId,
  size,
  lenses,
  seen,
  onSeen,
  onOff,
}: {
  laid: Layout;
  byId: Map<string, LedgerItem>;
  size: Size;
  lenses: boolean; // the lens row is on screen
  seen: ReadonlySet<string>;
  onSeen: (tip: TipId) => void;
  onOff: () => void;
}) {
  const [tx, ty, z] = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  if (!width || !height) return null;

  const box = (id: string) => {
    const p = laid.nodes.get(id)!;
    return {
      x: p.x * z + tx,
      y: p.y * z + ty,
      w: size.w * z,
      h: size.h * z,
    };
  };
  const onScreen: LedgerItem[] = [];
  for (const id of laid.order) {
    const i = id === ROOT ? undefined : byId.get(id);
    if (!i) continue;
    const b = box(id);
    if (b.x >= 0 && b.y >= 0 && b.x + b.w <= width && b.y + b.h <= height)
      onScreen.push(i);
  }
  const next = nextTip(onScreen, lenses, seen);
  if (!next) return null;

  const done = () => onSeen(next.tip);
  if (!next.item)
    return (
      <Tip
        tip={next.tip}
        style={{ top: GAP, left: 12, width: W }}
        onDone={done}
        onOff={onOff}
      />
    );
  const b = box(next.item);
  const left = Math.max(8, Math.min(b.x, width - W - 8));
  // under the box, or over it when there is no room below
  const below = b.y + b.h + GAP + 96 <= height;
  return (
    <Tip
      tip={next.tip}
      style={
        below
          ? { top: b.y + b.h + GAP, left, width: W }
          : { bottom: height - b.y + GAP, left, width: W }
      }
      onDone={done}
      onOff={onOff}
    />
  );
}
