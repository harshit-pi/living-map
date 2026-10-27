import { useState } from "react";

import { linkedTo, REVERSE } from "./lens.ts";
import { lookOf } from "./look.ts";
import type { ActResult } from "./useLedger.ts";
import type {
  ChangeStatement,
  LedgerAction,
  LedgerItem,
} from "../../shared/ledger.ts";

const BASIS: Record<LedgerItem["basis"], string> = {
  said: "Said in the chat",
  inferred: "Inferred from the chat",
  side: "From a side chat",
};

const turns = (src: number[]) =>
  src.length === 0
    ? ""
    : src.length === 1
      ? `turn ${src[0]}`
      : `turns ${src.join(", ")}`;

type Act = { label: string; action: LedgerAction; title?: string };

// what you can do on an item, by its type and state; the first is its main one
function actionsOf(i: LedgerItem): Act[] {
  const set = (state: string, label: string, title?: string): Act => ({
    label,
    title,
    action: { type: "state", item: i.id, state },
  });
  switch (i.type) {
    case "ask":
      return i.state === "waiting"
        ? [set("done", "Done", "You've dealt with it; Claude hears it now")]
        : [];
    case "question":
      return i.state === "open" ? [set("answered", "Answered")] : [];
    case "option":
      return i.state === "offered"
        ? [set("taken", "Take this", "Take this option; Claude hears it now")]
        : [];
    case "task":
      return i.state !== "done" && i.state !== "dropped" && i.owner !== "claude"
        ? [set("done", "Done", "Mark it done; Claude hears it now")]
        : [];
    case "decision":
      return i.state === "decided"
        ? [set("reopened", "Reopen", "Open it again; Claude hears it now")]
        : [];
    case "assumption":
      return i.state === "assumed"
        ? [set("confirmed", "Confirm"), set("struck", "Strike")]
        : [];
    default:
      return [];
  }
}

const answerable = (i: LedgerItem) =>
  (i.type === "ask" && i.state === "waiting") ||
  (i.type === "question" && i.state === "open");

// A clicked item, under the strip: what it is, the words it came from, and
// what you can do about it. Answers, picks and ticks go to the chat at
// once; the card says when the chat has them.
export function Card({
  item,
  byId,
  changes,
  primary,
  beside,
  half,
  act,
  onPick,
  onAsk,
  onClose,
  tip,
}: {
  item: LedgerItem;
  byId: Map<string, LedgerItem>;
  changes: ChangeStatement[];
  primary: boolean;
  beside: boolean; // the list is open at the right: the card opens left of it
  half: boolean; // a side chat covers the lower half: the card keeps above it
  act: (a: LedgerAction) => Promise<ActResult>;
  onPick: (id: string) => void;
  onAsk: () => void;
  onClose: () => void;
  tip?: React.ReactNode; // a one-time tip, over the actions
}) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<"" | "sending" | "sent">("");
  // what was told to the chat before this card opened isn't news here
  const [toldBefore] = useState(item.sent?.at ?? 0);
  const told = item.sent && item.sent.at > toldBefore ? item.sent : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const look = lookOf(item);
  const acts = actionsOf(item);
  const linked = linkedTo([...byId.values()], item.id);
  const canAnswer = answerable(item) && sent !== "sent";
  const owner =
    item.owner === "you" ? "Yours" : item.owner === "claude" ? "Claude's" : "";

  const run = async (a: LedgerAction) => {
    setBusy(true);
    setError("");
    const r = await act(a);
    setBusy(false);
    if (!r.ok) setError(r.error ?? "That didn't go through.");
    return r.ok;
  };
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setSent("sending");
    const ok = await run({ type: "answer", item: item.id, text: t });
    setSent(ok ? "sent" : "");
    if (ok) setText("");
  };

  const button =
    "rounded-lg border border-line-strong px-2.5 py-1 text-[12.5px] text-body hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40";
  const filled =
    "rounded-lg bg-primary px-3 py-1 text-[12.5px] font-medium text-on-primary hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-40";
  // the card owns the screen's one filled button: Send when you can answer,
  // else the item's main action
  const mainIsSend = canAnswer;

  return (
    <div
      role="dialog"
      aria-label={item.title}
      className={`absolute top-2 ${beside ? "right-[368px]" : "right-2"} left-2 z-30 ${half ? "max-h-[calc(50%-16px)]" : "max-h-[calc(100%-16px)]"} overflow-y-auto rounded-xl bg-surface p-3 shadow-xl ring-1 ring-line sm:left-auto sm:w-[400px]`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted">
          {look.tag === item.type ? item.type : `${item.type} · ${look.tag}`}
        </span>
        {owner && (
          <span className="mt-0.5 text-[11px] text-muted">{owner}</span>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mt-0.5 px-1 text-[16px] leading-none text-muted hover:text-ink"
        >
          ×
        </button>
      </div>
      <h2
        data-content
        className={`mt-1.5 text-[15px] leading-snug font-semibold ${look.title}`}
      >
        {item.title}
      </h2>
      {item.body && (
        <p
          data-content
          className="mt-1.5 text-[13px] leading-relaxed text-body"
        >
          {item.body}
        </p>
      )}
      {item.quote && (
        <figure className="mt-2.5 border-l-2 border-line-strong pl-2.5">
          <blockquote
            data-content
            className="text-[12.5px] leading-relaxed text-body italic"
          >
            “{item.quote}”
          </blockquote>
          {item.src.length > 0 && (
            <figcaption className="mt-0.5 text-[11px] text-muted">
              {turns(item.src)}
            </figcaption>
          )}
        </figure>
      )}
      <div className="mt-2 text-[11px] text-muted">{BASIS[item.basis]}</div>
      {(item.links.length > 0 || linked.length > 0) && (
        <ul className="mt-2 space-y-0.5">
          {linked.map(({ rel, from }) => (
            <li key={`${rel}<${from.id}`} className="text-[12px] text-muted">
              {REVERSE[rel] ?? `${rel} by`}{" "}
              <button
                onClick={() => onPick(from.id)}
                className="text-left text-body underline decoration-line-strong underline-offset-2 hover:text-ink"
                data-content
              >
                {from.title}
              </button>
            </li>
          ))}
          {item.links.map((l) => {
            const to = byId.get(l.to);
            const change = changes.find((c) => c.id === l.to);
            return (
              <li key={`${l.rel}-${l.to}`} className="text-[12px] text-muted">
                {l.rel.replace(/-/g, " ")}{" "}
                {to ? (
                  <button
                    onClick={() => onPick(to.id)}
                    className="text-left text-body underline decoration-line-strong underline-offset-2 hover:text-ink"
                    data-content
                  >
                    {to.title}
                  </button>
                ) : (
                  <span className="text-body" data-content>
                    {change?.text ?? "an item no longer on the map"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAnswer && (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
            rows={2}
            placeholder="Your answer goes to the chat at once"
            className="w-full resize-y rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-primary focus:outline-none"
          />
        </div>
      )}
      {(told || sent === "sent") && (
        <div
          role="status"
          className={`mt-3 rounded-lg px-2.5 py-1.5 text-[12.5px] ${told?.heard ? "bg-success-soft text-success-strong" : "bg-panel text-body"}`}
          title={
            told?.heard
              ? "Your chat took it from the map's inbox"
              : "It reaches Claude at its next step, or as soon as it is idle"
          }
        >
          {told?.heard ? "Sent · Claude has it" : "Sent to your chat"}
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-[12.5px] text-danger-strong">
          {error}
        </div>
      )}

      {!removing && tip}
      {removing ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12.5px] text-body">
            It goes from the map, and the map learns from it.
          </span>
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              void run({ type: "not-right", item: item.id }).then(
                (ok) => ok && onClose(),
              );
            }}
          >
            Remove it
          </button>
          <button className={button} onClick={() => setRemoving(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {canAnswer && (
            <button
              data-primary={primary || undefined}
              className={primary ? filled : button}
              disabled={!text.trim() || sent === "sending"}
              onClick={() => void send()}
            >
              {sent === "sending" ? "Sending…" : "Send"}
            </button>
          )}
          {acts.map((a, k) => {
            const main = primary && !mainIsSend && k === 0;
            return (
              <button
                key={a.label}
                data-primary={main || undefined}
                title={a.title}
                disabled={busy}
                className={main ? filled : button}
                onClick={() => void run(a.action)}
              >
                {a.label}
              </button>
            );
          })}
          <button className={button} onClick={() => setRemoving(true)}>
            Not right
          </button>
          <button
            className={button}
            onClick={onAsk}
            title="A side chat on this item: it reads the chat and your project, and changes nothing"
          >
            Ask about this
            {item.proposals ? (
              <span className="ml-1 rounded-full bg-hint-soft px-1.5 text-[11px] text-hint-strong">
                {item.proposals}
              </span>
            ) : null}
          </button>
        </div>
      )}
    </div>
  );
}
