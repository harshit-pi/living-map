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
}: {
  ws: Workspace;
  placeholder: string;
}) {
  const { map, live, selection, setSelection, roomy } = ws;
  const caption = useCaption(map, live.busy, live.stream);
  const one = selection.length === 1 ? selection[0] : null;
  // the panel already shows what is being written for its own node
  const inPanel =
    caption.live && !!live.working?.nodeId && live.working.nodeId === one;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 px-4 pb-4"
      style={{ paddingRight: one && roomy ? 450 : undefined }}
    >
      {caption.text && !inPanel && (
        <div
          onClick={caption.clear}
          className="pointer-events-auto max-w-2xl cursor-pointer rounded-2xl bg-white/95 px-4 py-2.5 shadow-lg ring-1 ring-cl-line backdrop-blur-sm"
        >
          <div className="answer answer-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {caption.text}
            </ReactMarkdown>
          </div>
        </div>
      )}
      <div className="pointer-events-auto w-full max-w-2xl">
        <Composer
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
          }}
        />
      </div>
    </div>
  );
}
