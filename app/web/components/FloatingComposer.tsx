import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Chip, Composer } from "./Composer.tsx";
import { useCaption } from "../hooks/useCaption.ts";
import type { Workspace } from "../lib/workspace.ts";

// The box at the bottom of the canvas for the main conversation, with the
// model's caption above it while it writes and for a few seconds after.
export function FloatingComposer({
  ws,
  placeholder,
  left,
  beside = true,
  sticky = false,
  scope,
  collapsed = false,
}: {
  ws: Workspace;
  placeholder: string;
  // where the canvas starts, when something sits left of it (Design's palette)
  left?: number;
  // the node panel floats over the right of the canvas when a node is
  // selected, so the box keeps clear of it; a screen whose side cards sit
  // beside the canvas instead says false
  beside?: boolean;
  // a reply to the box stays until clicked away (see useCaption)
  sticky?: boolean;
  // what a reply belongs to inside the map: it goes when this changes
  scope?: string;
  // a "💬 Ask Claude" pill until you want it: a wide empty box with two
  // pickers sat over every canvas, read as one more thing to do
  collapsed?: boolean;
}) {
  const { map, live, selection, setSelection, roomy } = ws;
  const [asking, setAsking] = useState(false);
  // the opened box folds back to the pill when you click away from it (or
  // press Esc) with nothing typed: what you typed is never thrown away
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!collapsed || !asking) return;
    const empty = () => !box.current?.querySelector("textarea")?.value.trim();
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && empty()) setAsking(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && empty()) setAsking(false);
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", onKey);
    };
  }, [collapsed, asking]);
  const caption = useCaption(map, live.busy, live.stream, sticky, scope);
  const one = selection.length === 1 ? selection[0] : null;
  // the panel already shows what is being written for its own node; a blank's
  // verdict streams on the blank (a right one comes up here once it is checked)
  const inPanel =
    caption.live &&
    ((!!live.working?.nodeId && live.working.nodeId === one) ||
      !!live.working?.blankId);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 px-4 pb-4"
      style={{ paddingRight: one && roomy && beside ? 450 : undefined, left }}
    >
      {caption.text && !inPanel && (
        // a reply that stays (Learn) is kept short on the canvas: a long
        // one covered the bottom of what you were building; it scrolls
        <div
          onClick={caption.clear}
          className={`pointer-events-auto max-w-2xl cursor-pointer rounded-2xl bg-surface/95 px-4 py-2.5 shadow-lg ring-1 ring-line backdrop-blur-sm ${sticky ? "max-h-28 overflow-y-auto" : ""}`}
        >
          <div className="answer answer-sm" data-content>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {caption.text}
            </ReactMarkdown>
          </div>
        </div>
      )}
      {collapsed && !asking ? (
        <button
          onClick={() => setAsking(true)}
          className="pointer-events-auto self-end rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-body shadow-md ring-1 ring-line-strong hover:ring-primary"
        >
          💬 Ask Claude
        </button>
      ) : (
        <div ref={box} className="pointer-events-auto w-full max-w-2xl">
          <Composer
            foldSettings={collapsed}
            autoFocus={collapsed}
            busy={live.busy}
            settings={ws.settings}
            onSettings={ws.onSettings}
            rows={1}
            onStop={ws.stop}
            placeholder={placeholder}
            chips={
              selection.length > 1
                ? selection.map((id) => (
                    <Chip
                      key={id}
                      onRemove={() =>
                        setSelection((s) => s.filter((x) => x !== id))
                      }
                    >
                      {map.nodes[id]?.title ?? id}
                    </Chip>
                  ))
                : undefined
            }
            onSend={(text) => {
              void ws.run({ type: "message", text, selection });
              if (collapsed) setAsking(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
