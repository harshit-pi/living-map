import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { viewOf } from "./view.ts";
import type { MapDoc, MapNode, Thread } from "../../../shared/model.ts";
import { Composer } from "../../../web/components/Composer.tsx";
import { NodePanel } from "../../../web/components/NodePanel.tsx";
import { ago } from "../../../web/lib/ago.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import {
  PLUGIN_ID,
  type ChatView,
  type Item,
  type ItemState,
} from "../shared.ts";

const ROOT = "root";
const FOLLOWING = "Following your chat";

type Filter = "todo" | "open" | "decided" | null;

const childrenOf = (map: MapDoc, id: string) =>
  Object.values(map.nodes)
    .filter((n) => n.parent === id)
    .sort((a, b) => a.order - b.order);

const threadsOf = (map: MapDoc, id: string): Thread[] =>
  Object.values(map.threads ?? {})
    .filter((t) => t.nodeId === id && t.messages.length)
    .sort((a, b) => a.createdAt - b.createdAt);

// every node under a topic, sub-topics included
function under(map: MapDoc, id: string): MapNode[] {
  const out: MapNode[] = [];
  for (const k of childrenOf(map, id)) out.push(k, ...under(map, k.id));
  return out;
}

const isTodo = (i?: Item) => i?.type === "task" && i.state === "pending";
// still to talk through: a question with no answer yet
const isOpen = (i?: Item) => i?.type === "question" && i.state === "open";
const isDecided = (i?: Item) =>
  i?.type === "decision" || (i?.type === "option" && i.state === "chosen");
const matches = (f: Filter, i?: Item) =>
  f === "todo" ? isTodo(i) : f === "open" ? isOpen(i) : isDecided(i);

// one look per kind of item, never colour alone: a mark, a word, a colour
function markOf(item: Item | undefined) {
  switch (item?.type) {
    case "task":
      return item.state === "done"
        ? { mark: "✓", word: "done", cls: "text-success-strong" }
        : item.state === "dropped"
          ? { mark: "–", word: "not doing", cls: "text-faint" }
          : { mark: "", word: "to do", cls: "text-warning-strong" };
    case "decision":
      return { mark: "◆", word: "decided", cls: "text-success-strong" };
    case "question":
      return item.state === "answered"
        ? { mark: "✓", word: "answered", cls: "text-success-strong" }
        : { mark: "?", word: "to discuss", cls: "text-warning-strong" };
    case "option":
      return item.state === "chosen"
        ? { mark: "◆", word: "chosen", cls: "text-success-strong" }
        : { mark: "○", word: "option", cls: "text-muted" };
    case "topic":
      return { mark: "●", word: "topic", cls: "text-primary-strong" };
    default:
      return { mark: "·", word: "note", cls: "text-muted" };
  }
}

// Chat: a live map of the conversation you are having in Claude Code, to read
// at a glance. On top, three counts (to do, to discuss, decided) that also
// filter the map; under them one folded card per topic, in the order they
// came up, each saying with chips and a bar how much of it is settled. Open a
// card for its items, open an item for its detail, its options and what you
// can do with it. Side chats open in the panel; your main chat hears what they
// answer.
export function ChatScreen({ ws }: { ws: Workspace }) {
  const { map, live, selection, setSelection } = ws;
  const view = viewOf(map);
  const items = useMemo(() => view?.items ?? {}, [view]);
  const [filter, setFilter] = useState<Filter>(null);
  // the cards you opened or folded; the newest topic starts open
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const [openItem, setOpenItem] = useState<string | null>(null);
  const chatting = selection.length === 1 ? map.nodes[selection[0]] : undefined;

  const topics = childrenOf(map, ROOT);
  const latest = topics.at(-1)?.id;
  const all = Object.values(map.nodes);
  const count = (f: Filter) =>
    all.filter((n) => matches(f, items[n.id])).length;
  const catchingUp = live.working?.label === FOLLOWING;

  const mark = (id: string, state: ItemState) =>
    void ws.run({
      type: "plugin",
      plugin: PLUGIN_ID,
      name: "task",
      args: { id, state },
    });
  const here: Here = {
    ws,
    map,
    items,
    fresh: new Set(view?.fresh ?? []),
    openItem,
    setOpenItem: (id) => setOpenItem((cur) => (cur === id ? null : id)),
    mark,
    sideChat: (id) => setSelection([id]),
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 pb-8 pt-3">
          <Status view={view} catchingUp={catchingUp} />
          <div className="mb-4 grid grid-cols-3 gap-2">
            <Tile
              n={count("todo")}
              word="to do"
              tone="warning"
              on={filter === "todo"}
              onClick={() => setFilter(filter === "todo" ? null : "todo")}
            />
            <Tile
              n={count("open")}
              word="to discuss"
              tone="warning"
              on={filter === "open"}
              onClick={() => setFilter(filter === "open" ? null : "open")}
            />
            <Tile
              n={count("decided")}
              word="decided"
              tone="success"
              on={filter === "decided"}
              onClick={() => setFilter(filter === "decided" ? null : "decided")}
            />
          </div>

          {filter ? (
            <Filtered here={here} filter={filter} topics={topics} />
          ) : (
            <ol className="space-y-2">
              {topics.map((t, i) => (
                <TopicCard
                  key={t.id}
                  here={here}
                  node={t}
                  index={i + 1}
                  open={unfolded[t.id] ?? t.id === latest}
                  onToggle={() =>
                    setUnfolded((u) => ({
                      ...u,
                      [t.id]: !(u[t.id] ?? t.id === latest),
                    }))
                  }
                />
              ))}
            </ol>
          )}
          {!topics.length && (
            <div className="mt-6 text-sm text-muted">
              {catchingUp
                ? "Reading your conversation…"
                : "Nothing mapped yet. Write in your chat and it shows up here."}
            </div>
          )}
          <WholeChats here={here} />
        </div>
      </div>

      {chatting ? (
        <NodePanel
          map={map}
          node={chatting}
          busy={live.busy}
          working={live.working}
          waiting={live.waiting}
          stream={live.stream}
          settings={ws.settings}
          onSettings={ws.onSettings}
          run={ws.run}
          onSelect={(id) => setSelection([id])}
          onClose={() => setSelection([])}
          plain
          tag={
            chatting.id === ROOT ? "side chat" : markOf(items[chatting.id]).word
          }
          actions={
            <span className="text-xs text-muted">
              Knows your whole main chat
              {view?.recent.at(-1)
                ? `, up to turn ${view.recent.at(-1)!.n}`
                : ""}
              . What it answers reaches your main chat with your next message
              there.
            </span>
          }
          placeholder={
            chatting.id === ROOT
              ? "Ask on the side about anything in this chat…"
              : `Ask on the side about “${chatting.title}”…`
          }
        />
      ) : (
        // docked under the cards, not over them: an overlay covered the last
        // card and its buttons
        <div className="border-t border-line bg-canvas px-4 py-2.5">
          <div className="mx-auto w-full max-w-3xl">
            <Latest view={view} />
            <Composer
              compact
              foldSettings
              rows={1}
              busy={false}
              settings={ws.settings}
              onSettings={ws.onSettings}
              placeholder="Side chat: ask anything about this chat…"
              onSend={(text) => {
                setSelection([ROOT]);
                void ws.run({ type: "thread", nodeId: ROOT, text });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

type Here = {
  ws: Workspace;
  map: MapDoc;
  items: Record<string, Item>;
  fresh: Set<string>;
  openItem: string | null;
  setOpenItem: (id: string) => void;
  mark: (id: string, state: ItemState) => void;
  sideChat: (id: string) => void;
};

function Status({
  view,
  catchingUp,
}: {
  view: ChatView | null;
  catchingUp: boolean;
}) {
  const [more, setMore] = useState(false);
  if (!view) return null;
  const behind = view.turns - view.mapped;
  return (
    <section className="mb-3">
      <div className="mb-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
        <span
          className={`inline-block h-2 w-2 rounded-full ${view.following ? (catchingUp ? "animate-pulse bg-primary" : "bg-success") : "bg-faint"}`}
        />
        <span>
          {!view.following
            ? "Paused"
            : catchingUp
              ? "Catching up…"
              : behind > 0
                ? `Following · ${behind} new`
                : "Following"}
        </span>
        <span>· {view.turns} turns</span>
        {view.syncedAt && <span>· {ago(view.syncedAt)}</span>}
        {view.unsent > 0 && (
          <span
            className="rounded-full bg-hint-soft px-1.5 text-hint-strong"
            title="Your main chat hears this with the next message you send there"
          >
            {view.unsent} waiting for your chat
          </span>
        )}
      </div>
      {view.summary && (
        <button
          onClick={() => setMore(!more)}
          title={more ? "Show less" : "Show all"}
          className={`block text-left text-[14px] leading-snug text-body ${more ? "" : "line-clamp-2"}`}
          data-content
        >
          {view.summary}
        </button>
      )}
    </section>
  );
}

// a count you can see from across the room; pressed, it filters the map
function Tile({
  n,
  word,
  tone,
  on,
  onClick,
}: {
  n: number;
  word: string;
  tone: "warning" | "success";
  on: boolean;
  onClick: () => void;
}) {
  const look =
    tone === "warning"
      ? on
        ? "border-warning bg-warning-soft"
        : "border-warning-line bg-surface hover:bg-warning-soft"
      : on
        ? "border-success bg-success-soft"
        : "border-success-line bg-surface hover:bg-success-soft";
  const num =
    tone === "warning" ? "text-warning-strong" : "text-success-strong";
  return (
    <button
      onClick={onClick}
      title={on ? "Show every topic" : `Show only what is ${word}`}
      className={`rounded-xl border px-3 py-2 text-left transition ${look} ${n ? "" : "opacity-60"}`}
    >
      <div className={`text-[22px] font-semibold leading-none ${num}`}>{n}</div>
      <div className="mt-1 text-[12px] text-muted">{word}</div>
    </button>
  );
}

// how much of a topic is settled, as chips and a bar
function tallyOf(here: Here, id: string) {
  const rows = under(here.map, id).map((n) => here.items[n.id]);
  const tasks = rows.filter((i) => i?.type === "task");
  const done = tasks.filter((i) => i?.state !== "pending").length;
  return {
    todo: rows.filter(isTodo).length,
    open: rows.filter(isOpen).length,
    decided: rows.filter(isDecided).length,
    tasks: tasks.length,
    done,
    sides: [id, ...under(here.map, id).map((n) => n.id)].reduce(
      (k, nid) => k + threadsOf(here.map, nid).length,
      0,
    ),
  };
}

function Chip({ children, cls }: { children: ReactNode; cls: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function TopicCard({
  here,
  node,
  index,
  open,
  onToggle,
}: {
  here: Here;
  node: MapNode;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = tallyOf(here, node.id);
  const kids = childrenOf(here.map, node.id);
  const settled = t.todo === 0 && t.open === 0;
  return (
    <li
      className={`overflow-hidden rounded-xl border bg-surface ${open ? "border-line-strong shadow-xs" : "border-line"}`}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-panel/60"
      >
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${settled ? "bg-success-soft text-success-strong" : "bg-primary-soft text-primary-strong"}`}
        >
          {settled && kids.length ? "✓" : index}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block text-[14.5px] font-semibold leading-snug text-ink"
            data-content
          >
            {node.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {t.todo > 0 && (
              <Chip cls="bg-warning-soft text-warning-strong">
                ☐ {t.todo} to do
              </Chip>
            )}
            {t.open > 0 && (
              <Chip cls="bg-warning-soft text-warning-strong">
                ? {t.open} to discuss
              </Chip>
            )}
            {t.decided > 0 && (
              <Chip cls="bg-success-soft text-success-strong">
                ◆ {t.decided}
              </Chip>
            )}
            {t.sides > 0 && (
              <Chip cls="bg-hint-soft text-hint-strong">⑂ {t.sides}</Chip>
            )}
            {t.tasks > 0 && (
              <span
                className="ml-1 h-1.5 w-14 overflow-hidden rounded-full bg-panel"
                title={`${t.done} of ${t.tasks} tasks done`}
              >
                <span
                  className="block h-full rounded-full bg-success"
                  style={{ width: `${(100 * t.done) / t.tasks}%` }}
                />
              </span>
            )}
          </span>
        </span>
        <span
          className={`mt-0.5 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-2 pb-2 pt-1.5">
          {node.summary && (
            <div
              className="px-1.5 pb-1.5 text-[12.5px] leading-snug text-muted"
              data-content
            >
              {node.summary}
            </div>
          )}
          <Rows here={here} nodes={kids} />
          <Branches here={here} nodeId={node.id} />
          <div className="px-1.5 pt-1">
            <button
              onClick={() => here.sideChat(node.id)}
              className="text-[12px] text-hint-strong hover:underline"
            >
              ⑂ Side chat on this topic
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// what to do first: open things before settled ones, notes last
const rank = (i?: Item) =>
  isTodo(i) || isOpen(i) ? 0 : i?.type === "note" ? 3 : isDecided(i) ? 1 : 2;

function Rows({ here, nodes }: { here: Here; nodes: MapNode[] }) {
  const sorted = [...nodes].sort(
    (a, b) =>
      rank(here.items[a.id]) - rank(here.items[b.id]) || a.order - b.order,
  );
  return (
    <div className="space-y-px">
      {sorted.map((n) =>
        here.items[n.id]?.type === "topic" ? (
          <SubTopic key={n.id} here={here} node={n} />
        ) : (
          <Row key={n.id} here={here} node={n} />
        ),
      )}
    </div>
  );
}

// a digression inside a topic: folded to its title and chips
function SubTopic({ here, node }: { here: Here; node: MapNode }) {
  const [open, setOpen] = useState(false);
  const t = tallyOf(here, node.id);
  return (
    <div className="my-1 rounded-lg border border-dashed border-line-strong">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="text-[12px] text-faint">↳</span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink"
          data-content
        >
          {node.title}
        </span>
        {t.todo + t.open > 0 && (
          <Chip cls="bg-warning-soft text-warning-strong">
            {t.todo + t.open}
          </Chip>
        )}
        <span
          className={`text-faint transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>
      {open && (
        <div className="px-1 pb-1.5">
          <Rows here={here} nodes={childrenOf(here.map, node.id)} />
        </div>
      )}
    </div>
  );
}

function Row({ here, node }: { here: Here; node: MapNode }) {
  const item = here.items[node.id];
  const look = markOf(item);
  const open = here.openItem === node.id;
  const task = item?.type === "task";
  const finished = (task && item?.state !== "pending") || node.dropped;
  const options = childrenOf(here.map, node.id).filter(
    (k) => here.items[k.id]?.type === "option",
  );
  const rest = childrenOf(here.map, node.id).filter(
    (k) => !options.includes(k),
  );
  const sides = threadsOf(here.map, node.id).length;
  return (
    // just filed or changed by the last catch-up: a quiet mark, nothing moves
    <div
      className={`rounded-lg ${open ? "bg-panel" : here.fresh.has(node.id) ? "bg-primary-soft/40" : ""}`}
    >
      <div className="flex items-start gap-2 px-1.5 py-1">
        {task ? (
          <button
            title={finished ? "Still to do" : "Mark done"}
            onClick={() => here.mark(node.id, finished ? "pending" : "done")}
            className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${finished ? "border-success bg-success-soft text-success-strong" : "border-warning bg-surface hover:bg-success-soft"}`}
          >
            {finished ? look.mark : ""}
          </button>
        ) : (
          <span
            title={look.word}
            className={`mt-px w-3.5 shrink-0 text-center text-[12px] font-semibold ${look.cls}`}
          >
            {look.mark}
          </span>
        )}
        <button
          onClick={() => here.setOpenItem(node.id)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left text-[13.5px] leading-snug"
        >
          <span
            className={finished ? "text-muted line-through" : "text-ink"}
            data-content
          >
            {node.title}
          </span>
          {sides > 0 && (
            <span className="ml-1.5 text-[11px] text-hint-strong">
              ⑂ {sides}
            </span>
          )}
        </button>
      </div>
      {options.length > 0 && <Options here={here} options={options} />}
      {open && (
        <div className="space-y-2 px-7 pb-2.5 pt-0.5">
          {node.summary && (
            <div className="text-[13px] leading-snug text-body" data-content>
              {node.summary}
            </div>
          )}
          {node.detail && (
            <div className="answer answer-sm" data-content>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {node.detail}
              </ReactMarkdown>
            </div>
          )}
          {rest.length > 0 && <Rows here={here} nodes={rest} />}
          <Branches here={here} nodeId={node.id} />
          <Actions here={here} node={node} item={item} />
        </div>
      )}
    </div>
  );
}

// the choices Claude offered under a question, as one group: the one you
// took stands out and the rest fold behind a count; with none taken yet, a
// few show and the rest wait behind "more". A click takes one (again: back
// to open).
function Options({ here, options }: { here: Here; options: MapNode[] }) {
  const [all, setAll] = useState(false);
  const chosen = options.filter((o) => here.items[o.id]?.state === "chosen");
  const shown = all
    ? options
    : chosen.length
      ? chosen
      : options
          .filter((o) => here.items[o.id]?.state !== "dropped")
          .slice(0, 3);
  const hidden = options.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1 px-7 pb-1.5">
      {!chosen.length && !all && (
        <span className="text-[11px] text-warning-strong">
          {options.length} options, none taken:
        </span>
      )}
      {shown.map((o) => {
        const st = here.items[o.id]?.state;
        const cls =
          st === "chosen"
            ? "border-success bg-success-soft font-medium text-success-strong"
            : st === "dropped"
              ? "border-dashed border-line-strong text-faint line-through"
              : "border-line-strong bg-surface text-body hover:border-primary";
        return (
          <button
            key={o.id}
            onClick={() => here.mark(o.id, st === "chosen" ? "open" : "chosen")}
            title={
              (o.summary ? `${o.summary}\n\n` : "") +
              (st === "chosen"
                ? "Click to reopen"
                : "Click to go with this one")
            }
            className={`rounded-full border px-2 py-0.5 text-[12px] ${cls}`}
            data-content
          >
            {st === "chosen" ? "◆ " : ""}
            {o.title}
          </button>
        );
      })}
      {(hidden > 0 || all) && (
        <button
          onClick={() => setAll(!all)}
          className="px-1 text-[11.5px] text-muted hover:text-ink"
        >
          {all
            ? "fewer"
            : chosen.length
              ? `+${hidden} other option${hidden === 1 ? "" : "s"}`
              : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}

function Actions({
  here,
  node,
  item,
}: {
  here: Here;
  node: MapNode;
  item: Item | undefined;
}) {
  const btn = (label: string, onClick: () => void, title?: string) => (
    <button
      key={label}
      onClick={onClick}
      title={title}
      className="whitespace-nowrap rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[12px] text-body hover:border-primary hover:text-primary-strong"
    >
      {label}
    </button>
  );
  const out: ReactNode[] = [];
  if (item?.type === "task") {
    if (item.state === "pending") {
      out.push(btn("Mark done", () => here.mark(node.id, "done")));
      out.push(btn("Not doing", () => here.mark(node.id, "dropped")));
    } else out.push(btn("Still to do", () => here.mark(node.id, "pending")));
  }
  if (item?.type === "question")
    out.push(
      item.state === "open"
        ? btn("Settled", () => here.mark(node.id, "answered"))
        : btn("Reopen", () => here.mark(node.id, "open")),
    );
  if (item?.type === "option" && item.state !== "dropped")
    out.push(btn("Pass on it", () => here.mark(node.id, "dropped")));
  out.push(
    btn(
      "⑂ Side chat",
      () => here.sideChat(node.id),
      "Ask about this on the side",
    ),
  );
  if (!node.detail)
    out.push(
      btn(
        "Tell me more",
        () => void here.ws.run({ type: "explain", nodeId: node.id }),
        "Everything the main chat said about it, in one place",
      ),
    );
  return <div className="flex flex-wrap gap-1.5">{out}</div>;
}

// the side chats that branch off a node, each with the last thing it said
function Branches({ here, nodeId }: { here: Here; nodeId: string }) {
  const threads = threadsOf(here.map, nodeId);
  if (!threads.length) return null;
  return (
    <div className="mt-1 space-y-1 px-1">
      {threads.map((t) => {
        const last = t.messages.filter((m) => m.role !== "system").at(-1);
        return (
          <button
            key={t.id}
            onClick={() => here.sideChat(nodeId)}
            className="flex w-full items-start gap-1.5 rounded-lg border border-hint-line bg-hint-soft px-2 py-1 text-left hover:border-hint"
          >
            <span className="text-[12px] text-hint-strong">⑂</span>
            <span
              className="min-w-0 flex-1 truncate text-[12.5px] text-hint-strong"
              data-content
            >
              {last?.text.replace(/\s+/g, " ").slice(0, 140)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// filtered: only what matches, under the topic it belongs to
function Filtered({
  here,
  filter,
  topics,
}: {
  here: Here;
  filter: Filter;
  topics: MapNode[];
}) {
  const groups = topics
    .map((t) => ({
      t,
      rows: under(here.map, t.id).filter((n) =>
        matches(filter, here.items[n.id]),
      ),
    }))
    .filter((g) => g.rows.length);
  if (!groups.length)
    return <div className="text-sm text-muted">Nothing here right now.</div>;
  return (
    <div className="space-y-3">
      {groups.map(({ t, rows }) => (
        <section key={t.id}>
          <div
            className="mb-0.5 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"
            data-content
          >
            {t.title}
          </div>
          <div className="space-y-px">
            {rows.map((n) => (
              <Row key={n.id} here={here} node={n} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// side chats asked about the whole conversation, not one part of it
function WholeChats({ here }: { here: Here }) {
  if (!threadsOf(here.map, ROOT).length) return null;
  return (
    <section className="mt-5">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Side chats on the whole chat
      </div>
      <Branches here={here} nodeId={ROOT} />
    </section>
  );
}

// the main chat's latest turn, one line: the map is of it
function Latest({ view }: { view: ChatView | null }) {
  const last = view?.recent.at(-1);
  if (!last) return null;
  return (
    <div
      className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted"
      title={last.text}
    >
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-success" />
      <span className="shrink-0">Turn {last.n} ·</span>
      <span className="min-w-0 truncate" data-content>
        {last.who === "you" ? "You: " : "Claude: "}
        {last.text.replace(/\s+/g, " ")}
      </span>
    </div>
  );
}
