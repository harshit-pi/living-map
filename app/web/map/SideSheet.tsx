import { Fragment, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { lookOf } from "./look.ts";
import type { ActResult } from "./useLedger.ts";
import type {
  LedgerAction,
  LedgerItem,
  LedgerView,
  SideChat,
  SideProposal,
} from "../../shared/ledger.ts";
import { More } from "../components/More.tsx";

const button =
  "rounded-lg border border-line-strong px-2.5 py-1 text-[12.5px] text-body hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40";
const filled =
  "rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-on-primary hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-40";

// A side chat, over the lower half of the map (never the strip): the item
// it is about on top, the messages as they stream, what it proposes for
// the map as a checklist, and a box to ask in. The other open side chats
// wait as chips along its top.
export function SideSheet({
  side,
  item,
  others,
  primary,
  act,
  onItem,
  onOpen,
  onHide,
}: {
  side: SideChat;
  item: LedgerItem | null; // gone from the map: the title it had
  others: LedgerView["sides"];
  primary: boolean; // the screen's one filled button is the sheet's
  act: (a: LedgerAction) => Promise<ActResult>;
  onItem: (id: string) => void;
  onOpen: (item: string) => void;
  onHide: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  // the messages follow the reply as it streams, unless you scrolled up
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastText = side.messages.at(-1)?.text ?? "";
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [side.messages.length, lastText, side.proposals.length]);
  const pending = side.proposals.filter((p) => p.status === "pending");
  const last = side.messages.at(-1);
  // the reply under way: the last of Claude's while it is busy
  const liveAt = side.busy
    ? side.messages.map((m) => m.role).lastIndexOf("claude")
    : -1;

  const run = async (a: LedgerAction) => {
    setError("");
    const r = await act(a);
    if (!r.ok) setError(r.error ?? "That didn't go through.");
    return r.ok;
  };
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    if (!(await run({ type: "side-say", side: side.id, text: t }))) setText(t);
  };
  // the filled button: Send while you write, else Apply when something waits
  const sendIsMain = !!text.trim() || !pending.length;

  return (
    <section
      aria-label={`Side chat on ${side.title}`}
      className="absolute inset-x-0 bottom-0 z-30 flex h-1/2 min-h-56 flex-col rounded-t-xl bg-surface shadow-xl ring-1 ring-line"
    >
      {others.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-1.5 pb-1 [scrollbar-width:none]">
          {others.map((o) => (
            <Chip
              key={o.id}
              side={o}
              onOpen={() => onOpen(o.item)}
              onClose={() => void run({ type: "side-close", side: o.id })}
            />
          ))}
        </div>
      )}
      <header className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="shrink-0 rounded-full bg-hint-soft px-2 py-0.5 text-[11px] text-hint-strong">
          Side chat
        </span>
        {item && (
          <span className="shrink-0 text-[11px] text-muted">
            {item.type} · {lookOf(item).tag}
          </span>
        )}
        <button
          onClick={() => item && onItem(item.id)}
          disabled={!item}
          title={item ? "Show it on the map" : "No longer on the map"}
          className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-ink hover:underline disabled:no-underline"
          data-content
        >
          {item?.title ?? side.title}
        </button>
        <More
          sections={[
            {
              items: [
                {
                  label: "End this side chat",
                  title: "It leaves the chips; what was said stays saved",
                  onClick: () => {
                    void run({ type: "side-close", side: side.id });
                    onHide();
                  },
                },
              ],
            },
          ]}
        />
        <button
          onClick={onHide}
          aria-label="Hide the side chat"
          title="Hide (it stays as a chip)"
          className="shrink-0 px-1 text-[16px] leading-none text-muted hover:text-ink"
        >
          ×
        </button>
      </header>

      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2"
      >
        {side.messages.length === 0 && (
          <p className="text-[12.5px] text-muted">
            Ask anything about this item. The side chat knows it, what sits
            around it and the turns it came from, and it can read your project
            and the whole chat. It changes nothing: what it concludes for the
            map comes to you to apply.
          </p>
        )}
        {side.messages.map((m, k) => (
          <Fragment key={k}>
            {m.role === "you" ? (
              <div className="ml-auto w-fit max-w-[85%] rounded-xl bg-bubble px-2.5 py-1.5 text-[13px] whitespace-pre-wrap text-ink">
                {m.text}
              </div>
            ) : (
              <div>
                {m.tools && m.tools.length > 0 && (
                  <div
                    className="mb-1 truncate text-[11px] text-faint"
                    title={m.tools.join("\n")}
                  >
                    {m.tools.slice(-3).join(" · ")}
                    {m.tools.length > 3 ? ` · ${m.tools.length - 3} more` : ""}
                  </div>
                )}
                {m.text ? (
                  <div className="answer answer-sm" data-content>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.text}
                    </ReactMarkdown>
                  </div>
                ) : k === liveAt ? (
                  <div className="text-[12.5px] text-muted">Reading…</div>
                ) : null}
                {m.stopped && (
                  <div className="mt-0.5 text-[11px] text-muted">Stopped</div>
                )}
              </div>
            )}
            {/* what this reply proposed, where it said it */}
            {side.proposals
              .filter(
                (p) =>
                  p.status !== "dropped" &&
                  m.role === "claude" &&
                  p.at >= m.at &&
                  !(side.messages[k + 1] && p.at >= side.messages[k + 1]!.at),
              )
              .map((p) =>
                p.status === "applied" ? (
                  <div
                    key={p.id}
                    className="rounded-lg bg-success-soft px-2.5 py-1.5 text-[12px] text-success-strong"
                  >
                    Applied to the map:{" "}
                    <span data-content>{p.ops.join("; ")}</span>
                  </div>
                ) : (
                  <Proposal
                    key={p.id}
                    p={p}
                    primary={primary && !sendIsMain}
                    onApply={(ops) =>
                      void run({
                        type: "apply-proposal",
                        side: side.id,
                        proposal: p.id,
                        ops,
                      })
                    }
                    onIgnore={() =>
                      void run({
                        type: "drop-proposal",
                        side: side.id,
                        proposal: p.id,
                      })
                    }
                  />
                ),
              )}
          </Fragment>
        ))}
        {side.busy && last?.role === "you" && (
          <div className="text-[12.5px] text-muted">Waiting its turn…</div>
        )}
        {(error || side.error) && (
          <div className="rounded-lg bg-danger-soft px-2.5 py-1.5 text-[12.5px] text-danger-strong">
            {error || side.error}
          </div>
        )}
      </div>

      <footer className="flex items-end gap-1.5 border-t border-line px-3 py-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={
            side.busy ? "Ask next; it waits its turn" : "Ask about this item"
          }
          aria-label="Your question"
          className="max-h-24 min-h-8 flex-1 resize-none rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-primary focus:outline-none"
        />
        {side.busy && (
          <button
            className={button}
            onClick={() => void run({ type: "side-stop", side: side.id })}
          >
            Stop
          </button>
        )}
        <button
          data-primary={(primary && sendIsMain) || undefined}
          className={primary && sendIsMain ? filled : button}
          disabled={!text.trim()}
          onClick={() => void send()}
        >
          Send
        </button>
      </footer>
    </section>
  );
}

// what a side chat proposes for the map: each change ticked to apply, and
// what the check left out, with why
function Proposal({
  p,
  primary,
  onApply,
  onIgnore,
}: {
  p: SideProposal;
  primary: boolean;
  onApply: (ops: number[]) => void;
  onIgnore: () => void;
}) {
  const [off, setOff] = useState<number[]>([]);
  const on = p.ops.map((_, k) => k).filter((k) => !off.includes(k));
  return (
    <div className="rounded-lg border border-hint-line bg-hint-soft px-2.5 py-2">
      <div className="text-[12px] font-medium text-hint-strong">
        For the map
      </div>
      <ul className="mt-1 space-y-0.5">
        {p.ops.map((o, k) => (
          <li key={k}>
            <label className="flex items-start gap-1.5 text-[12.5px] text-body">
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={!off.includes(k)}
                onChange={(e) =>
                  setOff(
                    e.target.checked ? off.filter((x) => x !== k) : [...off, k],
                  )
                }
              />
              <span data-content>{o}</span>
            </label>
          </li>
        ))}
        {p.dropped.map((d, k) => (
          <li
            key={`d${k}`}
            className="pl-5 text-[11.5px] text-muted"
            title={d.why}
          >
            Left out: <span data-content>{d.text}</span> ({d.why})
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-center gap-1.5">
        {p.ops.length > 0 && (
          <button
            data-primary={primary || undefined}
            className={primary ? filled : button}
            disabled={!on.length}
            onClick={() => onApply(on)}
          >
            Apply
          </button>
        )}
        <button
          className={button}
          onClick={onIgnore}
          title="Leave it off the map; left alone, it keeps waiting here"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// an open side chat waiting beside the one shown, or with none shown
export function Chip({
  side,
  onOpen,
  onClose,
}: {
  side: LedgerView["sides"][number];
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <span className="flex max-w-56 shrink-0 items-center rounded-full border border-hint-line bg-surface text-[12px] text-body">
      <button
        onClick={onOpen}
        title={`Side chat: ${side.title}`}
        className="flex min-w-0 items-center gap-1 py-0.5 pr-1 pl-2.5 hover:text-ink"
      >
        {side.busy && (
          <span
            aria-label="answering"
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-hint"
          />
        )}
        <span className="truncate" data-content>
          {side.title}
        </span>
      </button>
      <button
        onClick={onClose}
        aria-label={`End the side chat on ${side.title}`}
        className="pr-2 pl-0.5 text-muted hover:text-ink"
      >
        ×
      </button>
    </span>
  );
}
