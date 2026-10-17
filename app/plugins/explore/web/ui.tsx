// Small pieces the board's parts share: a button, a mark with its word, and a
// popover anchored on what opened it.

import {
  useEffect,
  useEffectEvent,
  useRef,
  type MouseEvent as ClickEvent,
  type ReactNode,
} from "react";

import { MARK_LOOK, type Mark } from "../shared.ts";
import type { Anchor } from "./view.ts";

export function Btn({
  children,
  onClick,
  primary,
  disabled,
  title,
  small,
}: {
  children: ReactNode;
  onClick: (e: ClickEvent<HTMLButtonElement>) => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
  small?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`whitespace-nowrap rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${small ? "px-2 py-0.5 text-[11.5px]" : "px-3 py-1 text-xs"} ${
        primary
          ? "bg-primary text-on-primary hover:bg-primary-strong"
          : "border border-line-strong bg-surface text-body hover:border-primary hover:text-primary-strong"
      }`}
    >
      {children}
    </button>
  );
}

// a mark is a symbol and a word, never colour alone; fails reads as a warning
export function MarkText({
  mark,
  className = "",
}: {
  mark: Mark;
  className?: string;
}) {
  const look = MARK_LOOK[mark];
  const tone =
    mark === "fails"
      ? "text-danger-strong"
      : mark === "unknown"
        ? "text-muted"
        : "text-ink";
  return (
    <span className={`whitespace-nowrap font-medium ${tone} ${className}`}>
      <span aria-hidden>{look.symbol}</span> {look.word}
    </span>
  );
}

// A popover opened from a click: under what opened it (above, near the bottom
// of the window), kept inside the window. Esc or a click outside closes it.
export function Pop({
  anchor,
  width,
  title,
  onClose,
  children,
}: {
  anchor: Anchor;
  width: number;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The listeners are added once, for as long as the popover is open. Esc
  // also clears the selection (App), which re-renders this with a new
  // onClose: listeners swapped then would be swapped mid-event, and a
  // listener added during an event never hears it, so Esc did nothing.
  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);
  const w = Math.min(width, anchor.vw - 32);
  const left = Math.max(16, Math.min(anchor.left, anchor.vw - w - 16));
  const below = anchor.bottom < anchor.vh * 0.6;
  return (
    <div
      ref={box}
      role="dialog"
      className="fixed z-50 rounded-xl bg-surface p-3 shadow-xl ring-1 ring-line"
      style={{
        width: w,
        left,
        ...(below
          ? { top: anchor.bottom + 6 }
          : { bottom: anchor.vh - anchor.top + 6 }),
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 text-[13px] font-semibold leading-snug text-ink">
          {title}
        </div>
        <button
          onClick={onClose}
          title="Close (Esc)"
          className="text-lg leading-none text-faint hover:text-ink"
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}
