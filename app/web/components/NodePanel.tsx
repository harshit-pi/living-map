import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Composer, type ComposerHandle } from "./Composer.tsx";
import { lookOf } from "./look.ts";
import {
  ASK_ANSWER,
  type Action,
  type MapDoc,
  type MapNode,
  type NodeAction,
  type Settings,
  type Working,
} from "../../shared/model.ts";

type Run = (a: Action) => Promise<{ threadId?: string }>;

function Btn({
  children,
  onClick,
  primary,
  disabled,
  title,
}: {
  children: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? "bg-primary text-on-primary hover:bg-primary-strong"
          : "border border-line-strong bg-surface text-body hover:border-primary hover:text-primary-strong"
      }`}
    >
      {children}
    </button>
  );
}

function pathOf(nodes: Record<string, MapNode>, id: string) {
  const out: MapNode[] = [];
  for (
    let n: MapNode | undefined = nodes[id];
    n;
    n = n.parent ? nodes[n.parent] : undefined
  )
    out.unshift(n);
  return out;
}

// Everything about one node in one place: what it is, what you can do with it,
// what is under it, and the side threads pinned to it. Selecting a node opens
// this with the cursor in its thread, so you reply on the visual itself.
export function NodePanel({
  map,
  node,
  busy,
  working,
  waiting = [],
  stream,
  settings,
  onSettings,
  run,
  onSelect,
  onClose,
  asSteps,
  actions,
  extra,
  tag,
  plain = false,
}: {
  map: MapDoc;
  node: MapNode;
  busy: boolean;
  working: Working | null;
  waiting?: { label: string; nodeId: string | null }[];
  stream: { threadId: string | null; text: string };
  settings: Settings;
  onSettings: (s: Partial<Settings>) => void;
  run: Run;
  onSelect: (id: string) => void;
  onClose: () => void;
  // treat questions as steps to work out (hints, show answer): Learn and Design
  asSteps?: boolean;
  // a plugin's own buttons for this node, in place of the usual row
  actions?: ReactNode;
  // a plugin's own lines under the summary (e.g. a board's case against)
  extra?: ReactNode;
  // a plugin's own word for the node's kind, over the title
  tag?: string;
  // fewer words: what Claude is sent goes into a tooltip, Fork is "New
  // thread", and the box asks what you know (Explore)
  plain?: boolean;
}) {
  const learn = !!asSteps;
  const threads = useMemo(
    () =>
      Object.values(map.threads ?? {})
        .filter((t) => t.nodeId === node.id)
        .sort((a, b) => a.createdAt - b.createdAt),
    [map.threads, node.id],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  // a different node starts on its latest thread, with nothing pending
  const [shownNode, setShownNode] = useState(node.id);
  if (shownNode !== node.id) {
    setShownNode(node.id);
    setActiveId(null);
  }
  // a move writing into one of this node's threads is the one to watch
  const streamingThread =
    busy && threads.some((t) => t.id === stream.threadId)
      ? stream.threadId
      : null;
  const active =
    threads.find((t) => t.id === (streamingThread ?? activeId)) ??
    threads[threads.length - 1];
  const composer = useRef<ComposerHandle>(null);
  const end = useRef<HTMLDivElement>(null);

  // selecting a node puts the cursor in its thread
  useEffect(() => {
    composer.current?.focus();
  }, [node.id]);
  const streamingHere = busy && !!active && stream.threadId === active.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [active?.messages.length, streamingHere, stream.text]);

  const look = lookOf(node, map.purpose);
  const gone = !!node.dropped || node.status === "dropped";
  const children = Object.values(map.nodes)
    .filter((n) => n.parent === node.id)
    .sort((a, b) => a.order - b.order);
  const hints = children.filter(
    (n) => n.kind === "fact" && /^hint\b/i.test(n.title),
  );
  const others = children.filter((n) => !hints.includes(n));
  const openStep =
    learn &&
    node.kind === "question" &&
    node.status === "open" &&
    !node.revealed;
  const path = pathOf(map.nodes, node.id);
  const claudeSees = `Claude sees: the map · ${path.map((p) => p.title).join(" → ")} · this thread only`;
  const act = (type: NodeAction) => {
    void run({ type, nodeId: node.id });
  };
  const writeIt = learn && /^write it/i.test(node.title);
  // a shown answer is read in the thread it was asked in, so its full copy
  // starts folded; older maps keep it open
  const answerInThread =
    node.revealed &&
    threads.some((t) => t.messages.some((m) => m.text === ASK_ANSWER));

  return (
    <aside className="absolute bottom-3 right-3 top-3 z-20 flex w-[min(420px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl bg-surface shadow-xl ring-1 ring-line">
      <div className="border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div
              className={`text-[10px] font-semibold uppercase tracking-wide ${look.tagCls}`}
            >
              {tag ?? look.tag}
            </div>
            <div
              className="mt-0.5 text-[17px] font-semibold leading-snug text-ink"
              data-content
            >
              {node.title}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="text-xl leading-none text-faint hover:text-ink"
          >
            ×
          </button>
        </div>
        {node.summary && (
          <div
            className="mt-1 text-[13.5px] leading-snug text-body"
            data-content
          >
            {node.summary.replace(/^Recommended:\s*/, "")}
          </div>
        )}
        {extra}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {actions ??
            (gone ? (
              <Btn onClick={() => act("restore")}>Restore</Btn>
            ) : (
              <>
                {node.kind === "option" && node.status !== "chosen" && (
                  <Btn primary onClick={() => act("choose")}>
                    {learn ? "Try this" : "Choose"}
                  </Btn>
                )}
                {openStep && (
                  <Btn
                    primary
                    disabled={hints.length >= 3}
                    onClick={() => act("hint")}
                    title="Each press gives a little more"
                  >
                    {hints.length >= 3
                      ? "No more hints"
                      : `Hint ${hints.length + 1} of 3`}
                  </Btn>
                )}
                <Btn onClick={() => act("deeper")}>
                  {learn && node.kind === "question"
                    ? "Smaller steps"
                    : "Go deeper"}
                </Btn>
                {!learn &&
                  (node.kind !== "option" || node.status === "chosen") && (
                    <Btn onClick={() => act("challenge")}>Challenge</Btn>
                  )}
                {!node.detail && (
                  <Btn onClick={() => act("explain")}>Explain</Btn>
                )}
                {openStep && (
                  <Btn
                    onClick={async () => {
                      // the answer arrives in this step's thread: show that one
                      const r = await run({
                        type: "answer",
                        nodeId: node.id,
                        threadId: active?.id,
                      });
                      if (r.threadId) setActiveId(r.threadId);
                    }}
                    title="Shown answers are not counted as yours"
                  >
                    Show answer
                  </Btn>
                )}
                {/* a step you have settled is done, not one to skip */}
                {!(
                  learn &&
                  node.kind === "question" &&
                  node.status === "answered"
                ) && (
                  <Btn
                    onClick={() => act("drop")}
                    title={
                      learn
                        ? node.kind === "question"
                          ? "Skip this step: it is greyed out and Claude stops raising it"
                          : "Remove it from what you looked into"
                        : "Rule this out: it is greyed out and Claude stops raising it"
                    }
                  >
                    {learn
                      ? node.kind === "question"
                        ? "Skip this step"
                        : "Remove"
                      : "Set aside"}
                  </Btn>
                )}
              </>
            ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!(working && working.nodeId === node.id) &&
          waiting.some((w) => w.nodeId === node.id) && (
            <div className="mb-3 rounded-lg border border-line bg-panel px-3 py-2.5 text-xs text-muted">
              <span className="font-medium text-body">Next in line.</span>{" "}
              Claude is first finishing{" "}
              {working ? (
                <>
                  {working.label.charAt(0).toLowerCase() +
                    working.label.slice(1)}
                  {working.nodeId && map.nodes[working.nodeId] ? (
                    <> for “{map.nodes[working.nodeId].title}”</>
                  ) : null}
                </>
              ) : (
                "another move"
              )}
              ; this one starts right after.
            </div>
          )}
        {working && working.nodeId === node.id && !working.threadId && (
          <div className="mb-3 rounded-lg border border-primary-line bg-primary-soft/60 px-3 py-2.5">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary-strong">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {working.label}…
            </div>
            <div className="space-y-1.5">
              <div className="skeleton w-11/12" />
              <div className="skeleton w-9/12" />
              <div className="skeleton w-10/12" />
            </div>
            {stream.threadId === null && stream.text && (
              <div className="mt-2 text-[12.5px] leading-snug text-body">
                {stream.text}
              </div>
            )}
          </div>
        )}
        {hints.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {hints.map((h) => (
              <div
                key={h.id}
                className="rounded-lg border border-hint-line bg-hint-soft px-3 py-2"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide text-hint-strong">
                  {h.title}
                </div>
                <div className="whitespace-pre-line text-[13.5px] leading-snug text-hint-strong">
                  {h.summary}
                </div>
              </div>
            ))}
          </div>
        )}
        {node.detail && (
          <details
            open={!answerInThread}
            className="mb-3 rounded-lg border border-line bg-panel px-3 py-2"
          >
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted">
              {node.revealed ? "Answer (shown)" : "Explanation"}
            </summary>
            <div className="answer answer-sm mt-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {node.detail}
              </ReactMarkdown>
            </div>
          </details>
        )}
        {others.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Under this
            </div>
            <div className="flex flex-wrap gap-1.5">
              {others.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className={`rounded-md border px-2 py-0.5 text-left text-xs hover:border-primary ${c.dropped ? "border-dashed border-line-strong text-faint line-through" : "border-line-strong text-body"}`}
                >
                  {c.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-2 flex items-center gap-1 border-b border-line pb-1.5">
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              title={plain ? claudeSees : undefined}
              className={`rounded-md px-2 py-0.5 text-xs ${active?.id === t.id ? "bg-panel font-medium text-ink" : "text-muted hover:text-ink"}`}
            >
              {t.title}
              {t.messages.length ? ` · ${t.messages.length}` : ""}
            </button>
          ))}
          {!threads.length && (
            <span
              className="text-xs text-muted"
              title={plain ? claudeSees : undefined}
            >
              Side thread
            </span>
          )}
          <div className="flex-1" />
          {threads.length > 0 && (
            <button
              title="Start a fresh thread on this node; the others stay as they are"
              onClick={async () => {
                const r = await run({ type: "fork", nodeId: node.id });
                if (r.threadId) {
                  setActiveId(r.threadId);
                  composer.current?.focus();
                }
              }}
              className="rounded-md px-2 py-0.5 text-xs text-primary-strong hover:bg-primary-soft disabled:opacity-40"
            >
              {plain ? "New thread" : "⑂ Fork"}
            </button>
          )}
        </div>
        {!plain && (
          <div
            className="mb-2 text-[11px] leading-snug text-faint"
            title="What Claude is sent for this thread"
          >
            {claudeSees}
          </div>
        )}
        <div className="space-y-3">
          {active?.messages.map((m, i) =>
            m.role === "you" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-bubble px-3 py-1.5 text-[13.5px] text-ink">
                  {m.text}
                </div>
              </div>
            ) : m.role === "claude" ? (
              <div key={i} className="answer answer-sm" data-content>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {m.text}
                </ReactMarkdown>
              </div>
            ) : (
              <div
                key={i}
                className="rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-strong"
              >
                {m.text}
              </div>
            ),
          )}
          {streamingHere && (
            <div className="answer answer-sm">
              {stream.text ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {stream.text}
                </ReactMarkdown>
              ) : (
                <span className="animate-pulse font-sans text-xs text-muted">
                  Claude is thinking…
                </span>
              )}
            </div>
          )}
          <div ref={end} />
        </div>
      </div>

      <div className="border-t border-line p-2.5">
        <Composer
          ref={composer}
          compact
          rows={writeIt ? 10 : 2}
          code={writeIt}
          busy={busy}
          settings={settings}
          onSettings={onSettings}
          onStop={() => {
            void run({ type: "stop" });
          }}
          placeholder={
            writeIt
              ? "Write your solution here. Claude traces it on the example and tells you where it breaks."
              : openStep
                ? "Your answer, or a question about this step…"
                : plain
                  ? "What do you know about this?"
                  : `Ask about “${node.title}”…`
          }
          onSend={(text) => {
            void run({
              type: "thread",
              nodeId: node.id,
              threadId: active?.id,
              text: writeIt ? `My code:\n\`\`\`\n${text}\n\`\`\`` : text,
            });
          }}
        />
      </div>
    </aside>
  );
}
