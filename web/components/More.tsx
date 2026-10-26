import { useEffect, useRef, useState, type ReactNode } from "react";

export type MoreItem = {
  label: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  // marked as the one in use
  on?: boolean;
  // the label is subject matter (an open question, a fact), not interface
  content?: boolean;
};

export type MoreSection = { head?: string; items: MoreItem[] };

// One ⋯ beside the screen's one next thing: everything else it can do, in
// one place.
export function More({ sections }: { sections: MoreSection[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    // heard first and kept from the page's own Esc, which would also close
    // the card under it
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const shown = sections.filter((s) => s.items.length);
  if (!shown.length) return null;
  const item = (it: MoreItem, k: number): ReactNode => (
    <button
      key={k}
      disabled={it.disabled}
      title={it.title}
      onClick={() => {
        setOpen(false);
        it.onClick();
      }}
      data-content={it.content || undefined}
      className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40 ${it.on ? "font-medium text-primary-strong" : "text-body"}`}
    >
      {it.on ? `✓ ${it.label}` : it.label}
    </button>
  );
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More"
        title="More"
        className={`flex h-7 w-7 items-center justify-center rounded-lg text-[16px] leading-none hover:bg-panel ${open ? "bg-panel text-ink" : "text-muted"}`}
      >
        ⋯
      </button>
      {open && (
        <div className="absolute top-8 right-0 z-40 max-h-[70vh] w-64 overflow-y-auto rounded-xl bg-surface py-1 shadow-xl ring-1 ring-line">
          {shown.map((s, i) => (
            <div key={i} className={i > 0 ? "border-t border-line pt-1" : ""}>
              {s.head && (
                <div className="px-3 pt-1 text-[11px] text-faint">{s.head}</div>
              )}
              {s.items.map(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
