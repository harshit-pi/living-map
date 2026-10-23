import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { MapDoc } from "../../shared/model.ts";
import { Composer } from "../../web/components/Composer.tsx";
import { ago } from "../../web/lib/ago.ts";
import { store, stored } from "../../web/lib/storage.ts";
import type { Workspace } from "../../web/lib/workspace.ts";
import {
  LAYER_ID,
  type Item,
  type ItemState,
  type LayerView,
  type SideChat,
} from "../shared.ts";

const VIEW_LABEL: Record<string, string> = {
  explore: "Explore",
  learn: "Learn",
  design: "Design",
};

const layerOf = (map: MapDoc): LayerView | null =>
  (map.data?.[LAYER_ID] as LayerView | undefined) ?? null;

type Section = "you" | "claude" | "open" | "decided" | "sides";

// The frame around every view of a map linked to your conversation. On top,
// one line: what Claude is on, the first thing waiting on you, and whether
// this view is behind the chat. On the right, the rail: counts that stay in
// the same place, opening into the lists (waiting on you, Claude still to do,
// decided, side chats), where you answer, pick, tick and ask on the side.
// What you do here reaches your main chat with your next message there.
export function Frame({
  ws,
  children,
}: {
  ws: Workspace;
  children: ReactNode;
}) {
  const view = layerOf(ws.map);
  const [open, setOpen] = useState(() => stored<boolean>("railOpen", false));
  const [jump, setJump] = useState<Section | null>(null);
  // a side chat on screen: one of the list, or a new one on an item
  const [side, setSide] = useState<{ id?: string; on: string } | null>(null);
  if (!view) return <div className="relative h-full">{children}</div>;
  const toggle = (to: boolean, at: Section | null = null) => {
    setOpen(to);
    store("railOpen", to);
    setJump(at);
  };
  const lanes = view.lanes;
  const catching =
    ws.live.working?.label.startsWith("Following") ||
    ws.live.working?.label.startsWith("Reading");
  const run = (name: string, args?: Record<string, unknown>) =>
    ws.run({ type: "plugin", plugin: LAYER_ID, name, args });
  const here: Here = {
    ws,
    view,
    run,
    mark: (id, state) => void run("mark", { id, state }),
    openSide: (on, id) => setSide({ on, id }),
  };
  return (
    <div className="flex h-full flex-col">
      <Strip here={here} onOpen={(at) => toggle(true, at)} />
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">{children}</div>
        {open && (
          <aside
            className={`${ws.roomy ? "relative" : "absolute top-0 bottom-0 right-12 z-30 shadow-xl"} flex w-[min(380px,calc(100vw-56px))] shrink-0 flex-col border-l border-line bg-surface`}
          >
            {side ? (
              <SidePanel
                here={here}
                side={side}
                onBack={() => setSide(null)}
                onOpened={(id) => setSide((s) => (s ? { ...s, id } : s))}
              />
            ) : (
              <Drawer
                here={here}
                jump={jump}
                catching={!!catching}
                onClose={() => toggle(false)}
              />
            )}
          </aside>
        )}
        <nav
          aria-label="Your conversation"
          className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-l border-line bg-panel py-2"
        >
          <span
            title={
              !view.following
                ? "Not following your chat"
                : catching
                  ? "Catching up with your chat"
                  : "Following your chat"
            }
            className={`mb-1 h-2 w-2 rounded-full ${!view.following ? "bg-faint" : catching ? "animate-pulse bg-primary" : "bg-success"}`}
          />
          <Count
            n={lanes.you.length}
            word="you"
            title="Waiting on you"
            tone="warning"
            strong
            onClick={() => toggle(true, "you")}
          />
          <Count
            n={lanes.claude.length}
            word="Claude"
            title="Claude still to do"
            tone="primary"
            onClick={() => toggle(true, "claude")}
          />
          <Count
            n={lanes.decided.length}
            word="decided"
            title="Decided"
            tone="success"
            onClick={() => toggle(true, "decided")}
          />
          <Count
            n={view.sides.length}
            word="side"
            title="Side chats (questions asked on the side)"
            tone="hint"
            onClick={() => toggle(true, "sides")}
          />
          <div className="flex-1" />
          <button
            title={open ? "Fold the rail" : "Open the rail"}
            onClick={() => toggle(!open)}
            className="rounded-md px-1.5 py-1 text-faint hover:bg-surface hover:text-ink"
          >
            {open ? "›" : "‹"}
          </button>
        </nav>
      </div>
    </div>
  );
}

type Here = {
  ws: Workspace;
  view: LayerView;
  run: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  mark: (id: string, state: ItemState) => void;
  openSide: (on: string, id?: string) => void;
};

function Count({
  n,
  word,
  title,
  tone,
  strong,
  onClick,
}: {
  n: number;
  word: string;
  title: string;
  tone: "warning" | "primary" | "success" | "hint";
  strong?: boolean;
  onClick: () => void;
}) {
  const look = {
    warning: "bg-warning-soft text-warning-strong ring-warning",
    primary: "bg-primary-soft text-primary-strong ring-primary",
    success: "bg-success-soft text-success-strong ring-success",
    hint: "bg-hint-soft text-hint-strong ring-hint",
  }[tone];
  return (
    <button
      title={`${title}: ${n}`}
      onClick={onClick}
      className={`flex w-10 flex-col items-center rounded-lg py-1 ${n ? look : "text-faint"} ${strong && n ? "ring-1" : ""} hover:brightness-95`}
    >
      <span className="text-[15px] font-semibold leading-none">{n}</span>
      <span className="mt-0.5 text-[10px] leading-none">{word}</span>
    </button>
  );
}

function Drawer({
  here,
  jump,
  catching,
  onClose,
}: {
  here: Here;
  jump: Section | null;
  catching: boolean;
  onClose: () => void;
}) {
  const { view, ws } = here;
  const refs = useRef<Partial<Record<Section, HTMLElement | null>>>({});
  useEffect(() => {
    if (jump) refs.current[jump]?.scrollIntoView({ block: "start" });
  }, [jump]);
  const items = (ids: string[]) =>
    ids.map((id) => view.items[id]).filter(Boolean);
  const [allDecided, setAllDecided] = useState(false);
  const decidedShown = allDecided
    ? view.lanes.decided
    : view.lanes.decided.slice(0, 4);
  const current = ws.map.purpose;
  const suggest =
    view.suggested && view.suggested.mode !== current ? view.suggested : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
          Your conversation
        </div>
        <span className="text-[11px] text-muted">
          {catching
            ? "catching up…"
            : view.syncedAt
              ? `updated ${ago(view.syncedAt)}`
              : ""}
        </span>
        <button
          onClick={onClose}
          title="Fold the rail"
          className="text-lg leading-none text-faint hover:text-ink"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <Tell here={here} />
        {view.pausedWhy && (
          <Banner tone="warning">
            {view.pausedWhy}{" "}
            <LinkButton
              onClick={() => void here.run("following", { on: true })}
            >
              Follow again
            </LinkButton>
          </Banner>
        )}
        {suggest && (
          <Banner tone="hint">
            Your chat now looks like{" "}
            <b>{VIEW_LABEL[suggest.mode] ?? suggest.mode}</b>
            {suggest.question ? `: “${suggest.question}”` : ""}.{" "}
            <LinkButton
              onClick={() => void here.run("view", { mode: suggest.mode })}
            >
              Open it
            </LinkButton>
          </Banner>
        )}
        {view.summary && (
          <div className="space-y-1">
            {view.summary && (
              <p className="text-[13px] leading-snug text-body" data-content>
                {view.summary}
              </p>
            )}
            {/* what Claude is on shows in the strip over the view */}
          </div>
        )}

        <Lane
          refEl={(el) => (refs.current.you = el)}
          title="Waiting on you"
          tone="warning"
          empty="Nothing: Claude is not waiting on you."
          items={items(view.lanes.you)}
          here={here}
          rich
        />
        <Lane
          refEl={(el) => (refs.current.claude = el)}
          title="Claude still to do"
          tone="primary"
          empty="Nothing left over."
          items={items(view.lanes.claude)}
          here={here}
        />
        {view.lanes.open.length > 0 && (
          <Lane
            refEl={(el) => (refs.current.open = el)}
            title="Still to talk through"
            tone="muted"
            items={items(view.lanes.open)}
            here={here}
          />
        )}
        <Lane
          refEl={(el) => (refs.current.decided = el)}
          title="Decided"
          tone="success"
          empty="Nothing settled yet."
          items={items(decidedShown)}
          here={here}
          more={
            view.lanes.decided.length > 4 ? (
              <LinkButton onClick={() => setAllDecided(!allDecided)}>
                {allDecided
                  ? "Fewer"
                  : `All ${view.lanes.decided.length} decisions`}
              </LinkButton>
            ) : null
          }
        />
        <section ref={(el) => void (refs.current.sides = el)}>
          <Heading tone="hint">Side chats</Heading>
          <div className="space-y-1">
            {view.sides.map((t) => (
              <SideRow
                key={t.id}
                t={t}
                onOpen={() => here.openSide(t.on, t.id)}
              />
            ))}
          </div>
          <button
            onClick={() => here.openSide("root")}
            className="mt-1.5 text-[12px] text-hint-strong hover:underline"
          >
            ⑂ Ask on the side about this chat
          </button>
        </section>
      </div>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "warning" | "hint";
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 text-[12px] leading-snug ${tone === "warning" ? "bg-warning-soft text-warning-strong" : "bg-hint-soft text-hint-strong"}`}
    >
      {children}
    </div>
  );
}

function LinkButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button onClick={onClick} className="font-medium underline">
      {children}
    </button>
  );
}

const HEAD: Record<string, string> = {
  warning: "text-warning-strong",
  primary: "text-primary-strong",
  success: "text-success-strong",
  hint: "text-hint-strong",
  muted: "text-muted",
};

function Heading({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <div
      className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${HEAD[tone]}`}
    >
      {children}
    </div>
  );
}

function Lane({
  title,
  tone,
  empty,
  items,
  here,
  rich,
  more,
  refEl,
}: {
  title: string;
  tone: string;
  empty?: string;
  items: Item[];
  here: Here;
  rich?: boolean;
  more?: ReactNode;
  refEl: (el: HTMLElement | null) => void;
}) {
  return (
    <section ref={refEl}>
      <Heading tone={tone}>
        {title}
        {items.length ? ` · ${items.length}` : ""}
      </Heading>
      {items.length ? (
        <div className={rich ? "space-y-1.5" : "space-y-px"}>
          {items.map((i) => (
            <ItemRow key={i.id} item={i} here={here} card={rich} />
          ))}
        </div>
      ) : (
        empty && <div className="text-[12px] text-faint">{empty}</div>
      )}
      {more && <div className="mt-1 text-[12px] text-muted">{more}</div>}
    </section>
  );
}

// one item: a line to read; on a card (waiting on you), what you can do with
// it is right there. A click opens its detail and actions; ⑂ asks about it
// on the side from any row.
function ItemRow({
  item,
  here,
  card,
}: {
  item: Item;
  here: Here;
  card?: boolean;
}) {
  const { view } = here;
  const [open, setOpen] = useState(false);
  const topic = item.parent ? view.items[item.parent] : undefined;
  const options = Object.values(view.items)
    .filter((o) => o.parent === item.id && o.type === "option")
    .sort((a, b) => a.order - b.order);
  const sides = view.sides.filter((t) => t.on === item.id).length;
  const fresh = view.fresh.includes(item.id);
  const task = item.type === "task";
  const yours = task && item.owner === "you";
  const finished = task && (item.state === "done" || item.state === "dropped");
  const settled =
    item.type === "decision" ||
    item.state === "chosen" ||
    (item.type === "question" && item.state === "answered");
  return (
    <div
      className={`group rounded-lg ${card ? "border border-warning-line bg-surface px-2.5 py-2" : `px-1.5 py-1 ${open ? "bg-panel" : fresh ? "bg-primary-soft/40" : "hover:bg-panel"}`}`}
    >
      <div className="flex items-start gap-2">
        <Mark item={item} here={here} yours={yours} finished={finished} />
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <span
            className={`text-[13px] leading-snug ${finished ? "text-muted line-through" : "text-ink"} ${card ? "font-medium" : ""}`}
            data-content
          >
            {item.title}
          </span>
          {item.state === "active" && (
            <span className="ml-1.5 rounded-full bg-primary-soft px-1.5 text-[10.5px] font-medium text-primary-strong">
              now
            </span>
          )}
          {sides > 0 && (
            <span className="ml-1.5 text-[11px] text-hint-strong">
              ⑂{sides}
            </span>
          )}
          {/* a decision says why on sight; the rest when opened */}
          {(open || card || settled) && item.summary && (
            <span
              className="mt-0.5 block text-[12px] leading-snug text-muted"
              data-content
            >
              {item.summary}
            </span>
          )}
          {open && topic && (
            <span className="mt-0.5 block text-[11px] text-faint" data-content>
              In “{topic.title}”
            </span>
          )}
        </button>
        <button
          title="Ask about this on the side: a chat that has read your whole main chat"
          onClick={() => here.openSide(item.id)}
          className={`shrink-0 rounded px-1 text-[12px] text-hint-strong hover:bg-hint-soft ${card || open ? "hidden" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
        >
          ⑂
        </button>
      </div>
      {options.length > 0 && <Options here={here} options={options} />}
      {(open || card) && <Actions here={here} item={item} />}
    </div>
  );
}

// what an item is at a glance: a box you tick for your own steps, a status
// mark for Claude's (it ticks its own), a ? for what is open, ◆ for settled
function Mark({
  item,
  here,
  yours,
  finished,
}: {
  item: Item;
  here: Here;
  yours: boolean;
  finished: boolean;
}) {
  if (yours)
    return (
      <button
        title={finished ? "Still to do" : "Mark done"}
        onClick={() => here.mark(item.id, finished ? "pending" : "done")}
        className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[10px] ${finished ? "border-success bg-success-soft text-success-strong" : "border-warning bg-surface hover:border-success"}`}
      >
        {finished ? "✓" : ""}
      </button>
    );
  const [mark, cls, word] =
    item.type === "task"
      ? item.state === "active"
        ? ["●", "animate-pulse text-primary", "Claude is on it"]
        : finished
          ? ["✓", "text-success-strong", "done"]
          : ["○", "text-primary-strong", "Claude still to do"]
      : item.type === "question" && item.state === "open"
        ? ["?", "text-warning-strong", "open"]
        : item.type === "note"
          ? ["·", "text-muted", "note"]
          : ["◆", "text-success-strong", "decided"];
  return (
    <span
      title={word}
      className={`mt-px w-3.5 shrink-0 text-center text-[12px] font-semibold ${cls}`}
    >
      {mark}
    </span>
  );
}

// the choices Claude offered, as one group: the one you took stands out and
// the rest fold behind a count; with none taken, a few show
function Options({ here, options }: { here: Here; options: Item[] }) {
  const [all, setAll] = useState(false);
  const chosen = options.filter((o) => o.state === "chosen");
  const shown = all
    ? options
    : chosen.length
      ? chosen
      : options.filter((o) => o.state !== "dropped").slice(0, 4);
  const hidden = options.length - shown.length;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-5">
      {shown.map((o) => (
        <button
          key={o.id}
          onClick={() =>
            here.mark(o.id, o.state === "chosen" ? "open" : "chosen")
          }
          title={`${o.summary ? `${o.summary}\n\n` : ""}${o.state === "chosen" ? "Click to reopen" : "Click to go with this one"}`}
          className={`rounded-full border px-2 py-0.5 text-[12px] ${o.state === "chosen" ? "border-success bg-success-soft font-medium text-success-strong" : o.state === "dropped" ? "border-dashed border-line-strong text-faint line-through" : "border-line-strong bg-surface text-body hover:border-primary"}`}
          data-content
        >
          {o.state === "chosen" ? "◆ " : ""}
          {o.title}
        </button>
      ))}
      {(hidden > 0 || all) && (
        <button
          onClick={() => setAll(!all)}
          className="px-1 text-[11.5px] text-muted hover:text-ink"
        >
          {all
            ? "fewer"
            : chosen.length
              ? `+${hidden} other`
              : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}

function Actions({ here, item }: { here: Here; item: Item }) {
  const btn = (label: string, onClick: () => void, title?: string) => (
    <button
      key={label}
      onClick={onClick}
      title={title}
      className="whitespace-nowrap rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[11.5px] text-body hover:border-primary hover:text-primary-strong"
    >
      {label}
    </button>
  );
  const out: ReactNode[] = [];
  const pending =
    item.type === "task" &&
    (item.state === "pending" || item.state === "active");
  // your steps you tick; Claude's it ticks itself, and you may call one off
  if (item.type === "task" && item.owner === "you")
    out.push(
      pending
        ? btn("Done", () => here.mark(item.id, "done"))
        : btn("Still to do", () => here.mark(item.id, "pending")),
    );
  if (pending)
    out.push(
      btn(
        item.owner === "you" ? "Not doing" : "Not needed",
        () => here.mark(item.id, "dropped"),
        "Takes it off the list; your main chat hears it",
      ),
    );
  if (item.type === "task" && item.state === "dropped")
    out.push(btn("Put back", () => here.mark(item.id, "pending")));
  if (item.type === "question")
    out.push(
      item.state === "open"
        ? btn("Settled", () => here.mark(item.id, "answered"))
        : btn("Reopen", () => here.mark(item.id, "open")),
    );
  out.push(
    btn(
      "⑂ Ask on the side",
      () => here.openSide(item.id),
      "A side chat that has read your whole main chat",
    ),
  );
  return <div className="mt-1.5 flex flex-wrap gap-1 pl-5">{out}</div>;
}

function SideRow({ t, onOpen }: { t: SideChat; onOpen: () => void }) {
  const last = t.lines.filter((l) => l.role !== "system").at(-1);
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-start gap-1.5 rounded-lg border border-hint-line bg-hint-soft px-2 py-1 text-left hover:border-hint"
    >
      <span className="text-[12px] text-hint-strong">⑂</span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[12px] font-medium text-hint-strong"
          data-content
        >
          {t.title}
        </span>
        <span
          className="block truncate text-[12px] text-hint-strong/80"
          data-content
        >
          {last?.text.replace(/\s+/g, " ")}
        </span>
      </span>
    </button>
  );
}

// a side chat, in the rail: what it is on and what it knows, its lines, and
// a box to ask more
function SidePanel({
  here,
  side,
  onBack,
  onOpened,
}: {
  here: Here;
  side: { id?: string; on: string };
  onBack: () => void;
  onOpened: (id: string) => void;
}) {
  const { view, ws } = here;
  // a new one is on screen as soon as the server has it, before it answers
  const [openedAt] = useState(() => Date.now() - 1000);
  const t = side.id
    ? view.sides.find((x) => x.id === side.id)
    : view.sides
        .filter((x) => x.on === side.on && x.createdAt >= openedAt)
        .at(-1);
  const on = side.on === "root" ? null : view.items[side.on];
  const streamId = t ? `side:${t.id}` : null;
  const streaming =
    ws.live.busy && !!streamId && ws.live.stream.threadId === streamId;
  const waiting = ws.live.working?.threadId === streamId;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [t?.lines.length, ws.live.stream.text]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-3 py-2">
        <button
          onClick={onBack}
          className="text-[12px] text-muted hover:text-ink"
        >
          ‹ Back
        </button>
        <div className="mt-0.5 text-[13px] font-semibold text-ink" data-content>
          ⑂ {t?.title ?? on?.title ?? "The whole conversation"}
        </div>
        <div className="text-[11px] text-muted">
          Knows your main chat
          {view.latest ? ` up to turn ${view.latest.n}` : ""}. What it answers
          reaches your main chat with your next message there.
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {t?.lines.map((l, i) =>
          l.role === "you" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-bubble px-3 py-1.5 text-[13px] text-ink">
                {l.text}
              </div>
            </div>
          ) : l.role === "claude" ? (
            <div key={i} className="answer answer-sm" data-content>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {l.text}
              </ReactMarkdown>
            </div>
          ) : (
            <div
              key={i}
              className="rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-strong"
            >
              {l.text}
            </div>
          ),
        )}
        {(streaming || waiting) && (
          <div className="answer answer-sm">
            {streaming && ws.live.stream.text ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {ws.live.stream.text}
              </ReactMarkdown>
            ) : (
              <span className="animate-pulse font-sans text-xs text-muted">
                Reading your chat…
              </span>
            )}
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="border-t border-line p-2">
        <Composer
          compact
          foldSettings
          autoFocus
          busy={false}
          settings={ws.settings}
          onSettings={ws.onSettings}
          placeholder={
            on ? `Ask about “${on.title}”…` : "Ask about anything in this chat…"
          }
          onSend={async (text) => {
            const r = (await here.run("side", {
              on: side.on,
              sideId: t?.id,
              text,
            })) as { threadId?: string };
            if (r?.threadId && !t) onOpened(r.threadId);
          }}
        />
      </div>
    </div>
  );
}

// what each view is called in a sentence ("this board is behind")
const VIEW_NOUN: Record<string, string> = {
  explore: "board",
  learn: "path",
  design: "design",
};

// One line over the view, readable without opening anything: what Claude is
// on, the first thing waiting on you (with its quickest action), and whether
// this view has fallen behind the chat.
function Strip({
  here,
  onOpen,
}: {
  here: Here;
  onOpen: (at: Section) => void;
}) {
  const { view, ws } = here;
  const you = view.lanes.you.map((id) => view.items[id]).filter(Boolean);
  const first = you[0];
  const noun = VIEW_NOUN[ws.map.purpose] ?? "view";
  const busy = ws.live.busy || ws.live.waiting.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-panel/60 px-4 py-1.5 text-[12.5px] leading-snug">
      {view.now && (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="text-muted">Claude is on</span>
          <span className="min-w-0 truncate text-ink" data-content>
            {view.now}
          </span>
        </span>
      )}
      {first ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="rounded-full bg-warning-soft px-1.5 font-medium text-warning-strong">
            You
          </span>
          <button
            onClick={() => onOpen("you")}
            className="min-w-0 truncate text-left text-ink hover:underline"
            data-content
          >
            {first.title}
          </button>
          {first.type === "task" && (
            <button
              onClick={() => here.mark(first.id, "done")}
              className="shrink-0 rounded-full border border-line-strong bg-surface px-2 text-[11.5px] text-body hover:border-success hover:text-success-strong"
            >
              Done
            </button>
          )}
          {you.length > 1 && (
            <button
              onClick={() => onOpen("you")}
              className="shrink-0 text-[11.5px] text-warning-strong hover:underline"
            >
              +{you.length - 1} more
            </button>
          )}
        </span>
      ) : (
        <span className="text-muted">Nothing is waiting on you</span>
      )}
      {view.behind > 0 && (
        <span className="ml-auto flex items-center gap-1.5 text-warning-strong">
          This {noun} is {view.behind} message{view.behind === 1 ? "" : "s"}{" "}
          behind your chat
          <button
            disabled={busy}
            onClick={() => void here.run("refresh")}
            className="rounded-full border border-warning-line bg-surface px-2 text-[11.5px] font-medium hover:bg-warning-soft disabled:opacity-50"
          >
            Update {noun}
          </button>
        </span>
      )}
    </div>
  );
}

// Writing to the main chat itself, from the map. With a listener running in
// it (the living-map skill starts one), Claude Code wakes and acts at once;
// without, it hears this with your next message there.
function Tell({ here }: { here: Here }) {
  const { view, ws } = here;
  const told = view.told;
  return (
    <section className="rounded-xl border border-primary-line bg-primary-soft/40 p-2">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[11.5px]">
        <span
          className={`h-1.5 w-1.5 rounded-full ${view.listening ? "bg-success" : "bg-faint"}`}
        />
        <span className={view.listening ? "text-success-strong" : "text-muted"}>
          {view.listening
            ? "Claude Code is listening: it acts as soon as you send"
            : "Claude Code hears this with your next message there"}
        </span>
      </div>
      {told.length > 0 && (
        <div className="mb-1.5 space-y-1 px-1">
          {told.map((t) => (
            <div key={t.ts} className="flex items-start gap-1.5 text-[12px]">
              <span
                title={
                  t.heard ? "Claude Code has it" : "Waiting for Claude Code"
                }
                className={t.heard ? "text-success-strong" : "text-faint"}
              >
                {t.heard ? "✓" : "…"}
              </span>
              <span className="min-w-0 flex-1 text-body">{t.text}</span>
            </div>
          ))}
        </div>
      )}
      <Composer
        compact
        foldSettings
        rows={1}
        busy={false}
        settings={ws.settings}
        onSettings={ws.onSettings}
        placeholder="Tell Claude Code… (e.g. go ahead and push)"
        onSend={(text) => void here.run("tell", { text })}
      />
    </section>
  );
}
