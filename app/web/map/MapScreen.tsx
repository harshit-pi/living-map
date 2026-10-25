import {
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Viewport,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Canvas } from "./Canvas.tsx";
import { Card } from "./Card.tsx";
import { Drawer } from "./Drawer.tsx";
import { layout, NODE_H, NODE_W, ROOT, type Layout } from "./layout.ts";
import {
  changedIds,
  foldsAbove,
  matcher,
  nowTopic,
  search,
  type Lens,
} from "./lens.ts";
import { SearchBox } from "./SearchBox.tsx";
import { snapOf, type Snap } from "./since.ts";
import { SinceBar, Strip } from "./Strip.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { useLedger } from "./useLedger.ts";
import type {
  LedgerAction,
  LedgerItem,
  LedgerView,
} from "../../shared/ledger.ts";
import { Mark } from "../components/Logo.tsx";
import { More } from "../components/More.tsx";
import { store, stored } from "../lib/storage.ts";

// coming back to the page after this long counts as a new look
const AWAY_MS = 5 * 60_000;
// below this width the card covers the top of the map instead of its side
const NARROW = 640;
const CARD_W = 400;

// The map of your chat: the strip, the lenses, and the mind map itself,
// with a card for the item you click and the list as a drawer.
export default function MapScreen({
  initial,
  fixture,
}: {
  initial: LedgerView;
  fixture: boolean;
}) {
  return (
    <ReactFlowProvider>
      <Screen initial={initial} fixture={fixture} />
    </ReactFlowProvider>
  );
}

const clampZoom = (z: number) => Math.min(1, Math.max(0.7, z));

// where the camera starts: the chat's root at the left edge when the window
// has room for a few columns, else the topic Claude is on
function startAt(v: LedgerView): Viewport {
  const l = layout(v.items, (id) => !!v.items.find((i) => i.id === id)?.folded);
  const zoom = 0.85;
  const w = typeof window === "undefined" ? 1024 : window.innerWidth;
  const h = typeof window === "undefined" ? 768 : window.innerHeight;
  const t = nowTopic(v.items);
  const p = (t && l.nodes.get(t.id)) || l.nodes.get(ROOT)!;
  const left = w >= 900 ? l.nodes.get(ROOT)! : p;
  // the top of the map when that keeps the topic well in view
  const top = 16 + p.y * zoom < h * 0.6;
  return {
    x: Math.round(16 - left.x * zoom),
    y: Math.round(top ? 16 : Math.min(h * 0.25, 140) - p.y * zoom),
    zoom,
  };
}

function Screen({
  initial,
  fixture,
}: {
  initial: LedgerView;
  fixture: boolean;
}) {
  const { view, online, linked, act } = useLedger(initial, fixture);
  const rf = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);

  const [lens, setLens] = useState<Lens | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // folds you set here, over the server's, so a fold shows at once
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [drawer, setDrawer] = useState(false);
  const [changesFirst, setChangesFirst] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(() => stored("map.compact", false));
  const [snap, setSnap] = useState<Snap | null>(() =>
    snapOf(initial, layout(initial.items).order),
  );
  const [step, setStep] = useState(-1);
  const [following, setFollowing] = useState(false);
  const [error, setError] = useState("");
  const [start] = useState(() => startAt(initial));

  const items = view.items;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const folded = useCallback(
    (id: string) => folds[id] ?? !!byId.get(id)?.folded,
    [folds, byId],
  );
  const laid = useMemo(() => layout(items, folded), [items, folded]);
  // every item in map order, folds open: the order the since bar steps in
  const order = useMemo(() => layout(items).order, [items]);
  const changed = useMemo(
    () => changedIds(items, view.changes),
    [items, view.changes],
  );
  const counts = useMemo(
    () => ({
      waiting: items.filter(matcher("waiting", changed)).length,
      open: items.filter(matcher("open", changed)).length,
      decided: items.filter(matcher("decided", changed)).length,
      changed: changed.size,
    }),
    [items, changed],
  );
  const lit = useMemo((): ((i: LedgerItem) => boolean) | null => {
    if (searching && query.trim()) {
      const ids = new Set(search(items, query).map((i) => i.id));
      return (i) => ids.has(i.id);
    }
    return lens ? matcher(lens, changed) : null;
  }, [searching, query, items, lens, changed]);
  const newIds = useMemo(
    () =>
      new Set([
        ...(snap?.ids ?? []),
        ...items.filter((i) => i.isNew).map((i) => i.id),
      ]),
    [snap, items],
  );
  // an item that left the map (Not right, or merged) closes its card
  const card = selected ? (byId.get(selected) ?? null) : null;
  const now = nowTopic(items);
  const firstWaiting =
    view.strip.waiting.map((id) => byId.get(id)).find(Boolean) ??
    items.find((i) => i.waiting) ??
    null;

  const run = useCallback(
    async (a: LedgerAction) => {
      const r = await act(a);
      if (!r.ok) setError(r.error ?? "That didn't go through.");
      return r;
    },
    [act],
  );
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 6000);
    return () => clearTimeout(t);
  }, [error]);

  // the latest view and order, for listeners set up once
  const latest = useRef({ view, order });
  useEffect(() => {
    latest.current = { view, order };
  }, [view, order]);

  // You look at the page when it gains focus after five minutes or more
  // away: the bar keeps what you had not seen, and the server counts from
  // now. Opened in view, the page is a look already.
  useEffect(() => {
    const inView = () =>
      document.visibilityState === "visible" && document.hasFocus();
    let away: number | null = inView() ? null : 0;
    if (away === null) void act({ type: "looked" });
    const back = () => {
      if (away === null) return;
      const long = Date.now() - away >= AWAY_MS;
      away = null;
      if (!long) return;
      setSnap(snapOf(latest.current.view, latest.current.order));
      setStep(-1);
      void act({ type: "looked" });
    };
    const gone = () => {
      away ??= Date.now();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") gone();
      else if (document.hasFocus()) back();
    };
    window.addEventListener("focus", back);
    window.addEventListener("blur", gone);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", back);
      window.removeEventListener("blur", gone);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [act]);

  // the camera, moved only when you ask: a step, a pick, Now
  const centre = useCallback(
    (id: string, l: Layout, withCard: boolean) => {
      const p = l.nodes.get(id);
      if (!p) return;
      const zoom = clampZoom(rf.getZoom());
      const narrow = width < NARROW;
      // with the card open, the item lands beside it, not under it
      const dx = withCard && !narrow ? CARD_W / 2 / zoom : 0;
      const dy = withCard && narrow ? (height * 0.25) / zoom : 0;
      void rf.setCenter(p.x + NODE_W / 2 + dx, p.y + NODE_H / 2 - dy, {
        zoom,
        duration: 300,
      });
    },
    [rf, width, height],
  );
  const frameLeft = useCallback(
    (id: string, l: Layout, duration = 300) => {
      const p = l.nodes.get(id);
      if (!p) return;
      const zoom = clampZoom(rf.getZoom());
      void rf.setViewport(
        {
          x: 16 - p.x * zoom,
          y: Math.min(height * 0.2, 120) - p.y * zoom,
          zoom,
        },
        { duration },
      );
    },
    [rf, height],
  );

  // open the folds an item sits in (and, for Now, the topic itself); gives
  // the layout it will have, so the camera can go there at once
  const reveal = (id: string, self = false): Layout => {
    const open = foldsAbove(items, id, folded);
    if (self && folded(id)) open.push(id);
    if (!open.length) return laid;
    const next = { ...folds };
    for (const f of open) {
      next[f] = false;
      void run({ type: "fold", item: f, folded: false });
    }
    setFolds(next);
    return layout(items, (x) => next[x] ?? !!byId.get(x)?.folded);
  };

  const setStrip = (on: boolean) => {
    setCompact(on);
    store("map.compact", on);
  };

  const pick = (id: string) => {
    const item = byId.get(id);
    if (!item) return;
    // picked from the strip alone: the map comes back to show it
    if (compact) setStrip(false);
    setFollowing(false);
    const l = reveal(id);
    if (item.type === "topic") {
      // a topic goes to the left edge, so what it holds is in view
      setSelected(null);
      frameLeft(id, l);
    } else {
      setSelected(id);
      centre(id, l, true);
    }
  };

  const toggleFold = (id: string) => {
    const next = !folded(id);
    setFolds((f) => ({ ...f, [id]: next }));
    void run({ type: "fold", item: id, folded: next });
  };

  const goNow = () => {
    if (!now) return;
    const l = reveal(now.id, true);
    setSelected(null);
    setFollowing(true);
    frameLeft(now.id, l);
  };
  // following Now: the camera stays on that topic as the map grows, until
  // you move it yourself
  const nowId = now?.id ?? null;
  useEffect(() => {
    if (following && nowId) frameLeft(nowId, laid, 200);
  }, [following, nowId, laid, frameLeft]);

  const onNode = (id: string) => {
    const item = byId.get(id);
    if (!item) return;
    if (item.type === "topic") return toggleFold(id);
    if (selected === id) return setSelected(null);
    setSelected(id);
    // on a narrow pane the card covers the top: an item under it comes down
    const p = laid.nodes.get(id);
    const vp = rf.getViewport();
    if (p && width < NARROW && p.y * vp.zoom + vp.y < height * 0.55)
      centre(id, laid, true);
  };

  const stepTo = (to: number) => {
    if (!snap) return;
    const id = snap.ids[to];
    if (!id) return;
    setStep(to);
    pick(id);
  };

  // ⌘F searches the map; Esc closes the search, then the card, then the list
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearching(true);
      } else if (e.key === "Escape") {
        if (searching) {
          setSearching(false);
          setQuery("");
        } else if (selected) setSelected(null);
        else if (drawer) setDrawer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searching, selected, drawer]);

  const more = (
    <More
      sections={[
        {
          items: [
            {
              label: compact ? "Show the map" : "Strip only",
              onClick: () => setStrip(!compact),
            },
          ],
        },
        {
          head: "The map's own work",
          items: [
            {
              label: `Today $${view.spend.todayUsd.toFixed(2)} · in all $${view.spend.usd.toFixed(2)} (${view.spend.calls} reads)`,
              onClick: () => {},
              disabled: true,
            },
          ],
        },
      ]}
    />
  );

  if (!linked)
    return (
      <Notice title="This page isn't linked to a chat">
        Say <code>/living-map</code> in your Claude Code chat to link it again.
      </Notice>
    );

  const showSince = !!snap && (snap.ids.length > 0 || snap.waiting > 0);

  const top = (
    <>
      <Strip
        view={view}
        firstWaiting={firstWaiting}
        onWaiting={pick}
        onWaitingLens={() => setLens(lens === "waiting" ? null : "waiting")}
        waitingLens={lens === "waiting"}
        more={more}
      />
      {showSince && snap && (
        <SinceBar
          snap={snap}
          at={step}
          primary={!card}
          onStep={stepTo}
          onClose={() => {
            setSnap(null);
            setStep(-1);
          }}
        />
      )}
      {!online && !fixture && (
        <div className="bg-warning-soft px-3 py-1 text-[12.5px] text-warning-strong">
          Lost the connection to the Living Map server; reconnecting…
        </div>
      )}
      {view.health.error && (
        <div
          className="bg-danger-soft px-3 py-1 text-[12.5px] text-danger-strong"
          title={view.health.error}
        >
          The map couldn't file the latest turns. It tries again after the next
          one.
        </div>
      )}
    </>
  );

  if (compact)
    return (
      <div className="flex h-full flex-col bg-canvas">
        {top}
        <button
          onClick={() => setStrip(false)}
          className="mx-3 mt-2 self-start rounded-lg border border-line-strong px-2.5 py-1 text-[12.5px] text-body hover:bg-panel"
        >
          Show the map
        </button>
      </div>
    );

  return (
    <div className="flex h-full flex-col bg-canvas">
      {top}
      <Toolbar
        lens={lens}
        counts={counts}
        onLens={(l) => {
          setLens(l);
          if (l === "changed" && view.changes.length) {
            setChangesFirst(true);
          }
        }}
        onSearch={() => setSearching(true)}
        onNow={goNow}
        onList={() => {
          setChangesFirst(false);
          setDrawer(!drawer);
        }}
        listOpen={drawer}
        canNow={!!now}
      />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <Canvas
          title={view.title}
          items={items}
          laid={laid}
          folded={folded}
          lit={lit}
          newIds={newIds}
          selected={selected}
          initial={start}
          onNode={onNode}
          onPane={() => setSelected(null)}
          onUserMove={() => setFollowing(false)}
        />
        {items.length === 0 && <Empty view={view} />}
        {/* floats over the map, so turning the lens on moves nothing */}
        {lens === "changed" && view.changes.length > 0 && !drawer && (
          <div className="absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-full bg-surface px-3 py-1 text-[12.5px] whitespace-nowrap text-body shadow-md ring-1 ring-line">
            <span className="truncate">
              {view.changes.filter((c) => !c.low).length} changes in your system
              this session
            </span>
            <button
              onClick={() => {
                setChangesFirst(true);
                setDrawer(true);
              }}
              className="shrink-0 text-[12px] text-ink underline underline-offset-2"
            >
              Show them
            </button>
          </div>
        )}
        {searching && (
          <SearchBox
            items={items}
            query={query}
            onQuery={setQuery}
            onPick={(id) => {
              setSearching(false);
              setQuery("");
              pick(id);
            }}
            onClose={() => {
              setSearching(false);
              setQuery("");
            }}
          />
        )}
        {card && !searching && (
          <Card
            key={card.id}
            item={card}
            byId={byId}
            changes={view.changes}
            primary
            act={act}
            onPick={pick}
            onClose={() => setSelected(null)}
          />
        )}
        <Drawer
          open={drawer}
          items={items}
          changes={view.changes}
          changesFirst={changesFirst}
          selected={selected}
          onPick={(id) => {
            // on a narrow pane the list covers the map: it steps aside
            if (width < NARROW) setDrawer(false);
            pick(id);
          }}
          onReview={(a) => void run(a)}
          onClose={() => setDrawer(false)}
        />
        {error && (
          <div className="absolute top-2 left-1/2 z-40 flex max-w-[min(480px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-lg bg-warning-soft px-3 py-1.5 text-sm text-warning-strong shadow-md ring-1 ring-warning-line">
            <span className="min-w-0 flex-1">{error}</span>
            <button onClick={() => setError("")} className="shrink-0">
              ×
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// nothing on the map yet: reading a long chat, or nothing filed
function Empty({ view }: { view: LedgerView }) {
  const r = view.health.reading;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
      <div className="pointer-events-auto max-w-xs rounded-xl bg-surface p-4 text-center shadow-md ring-1 ring-line">
        {r ? (
          <>
            <div className="text-[14px] font-medium text-ink">
              Reading your chat
            </div>
            <p className="mt-1 text-[12.5px] text-body">
              {r.done} of {r.total} turns so far. What's asked, decided and left
              to do shows up as it's found.
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{
                  width: `${Math.round((100 * r.done) / Math.max(1, r.total))}%`,
                }}
              />
            </div>
          </>
        ) : view.health.error ? (
          <>
            <div className="text-[14px] font-medium text-ink">
              The map couldn't read your chat yet
            </div>
            <p className="mt-1 text-[12.5px] text-body">
              It tries again after the next turn.
            </p>
          </>
        ) : (
          <>
            <div className="text-[14px] font-medium text-ink">
              Nothing filed yet
            </div>
            <p className="mt-1 text-[12.5px] text-body">
              As you and Claude talk, what's asked, decided and left to do shows
              up here.
              {view.health.behind > 0
                ? ` ${view.health.behind} turns are still to read.`
                : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas px-6">
      <div className="max-w-sm text-center">
        <Mark size={36} className="mx-auto" />
        <h1 className="mt-3 text-[15px] font-semibold text-ink">{title}</h1>
        <p className="mt-1.5 text-[13px] text-body">{children}</p>
      </div>
    </div>
  );
}
