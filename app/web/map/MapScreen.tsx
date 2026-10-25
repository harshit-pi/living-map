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
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Canvas } from "./Canvas.tsx";
import { Card } from "./Card.tsx";
import { Drawer } from "./Drawer.tsx";
import {
  layout,
  NARROW,
  NARROW_PANE,
  ROOT,
  sizeFor,
  WIDE,
  type Layout,
} from "./layout.ts";
import {
  changedIds,
  foldsAbove,
  matcher,
  nowTopic,
  search,
  type Lens,
} from "./lens.ts";
import { SearchBox } from "./SearchBox.tsx";
import { Chip, SideSheet } from "./SideSheet.tsx";
import { newIds, snapOf, type Snap } from "./since.ts";
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
const CARD_W = 400;
const DRAWER_W = 360;
// from this width the card opens beside the open list instead of over it
const SIDE_BY_SIDE = CARD_W + DRAWER_W + 320;

// what a lens with nothing in it says, so a map dimmed all over reads as
// "none", not as broken
const NONE: Record<Lens, string> = {
  waiting: "Nothing is waiting on you",
  open: "Nothing is open",
  decided: "Nothing is decided yet",
  changed: "Nothing here is tied to a change in your system yet",
};

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

// the window is the pane the map sits in; only crossing NARROW_PANE re-renders
const onResize = (f: () => void) => {
  window.addEventListener("resize", f);
  return () => window.removeEventListener("resize", f);
};
const isNarrow = () => window.innerWidth < NARROW_PANE;

// how far in from the pane's left edge a framed topic sits: on a narrow pane
// little enough that the topic, its items and theirs all fit
const marginX = (narrow: boolean) => (narrow ? 8 : 16);
// how far down a framed topic sits: on a narrow pane at the top, so what it
// holds fills the pane below it
const marginY = (narrow: boolean, h: number) =>
  narrow ? 16 : Math.min(h * 0.2, 120);

// Where the camera starts. On a narrow pane, the topic Claude is on at the
// top left, at full size, so its items read beside it. Wider, the whole tree
// from the chat's root, zoomed so its columns fill the width instead of
// leaving the right of the pane empty; scrolled down to that topic only when
// it would start below the fold.
function startAt(
  v: LedgerView,
  w = typeof window === "undefined" ? 1024 : window.innerWidth,
  h = typeof window === "undefined" ? 768 : window.innerHeight,
): Viewport {
  const size = sizeFor(w);
  const l = layout(
    v.items,
    (id) => !!v.items.find((i) => i.id === id)?.folded,
    size,
  );
  const t = nowTopic(v.items);
  const root = l.nodes.get(ROOT)!;
  const p = (t && l.nodes.get(t.id)) || root;
  let wide = 0;
  for (const n of l.nodes.values()) wide = Math.max(wide, n.x + size.w);
  const narrow = w < NARROW_PANE;
  const zoom = narrow
    ? 1
    : Math.min(1.15, Math.max(0.7, (w - 32) / Math.max(1, wide)));
  const left = narrow ? p : root;
  // the top of the map when that keeps the topic well in view
  const top = 16 + p.y * zoom < h * (narrow ? 0.4 : 0.6);
  return {
    x: Math.round(marginX(narrow) - left.x * zoom),
    y: Math.round(top ? 16 : marginY(narrow, h) - p.y * zoom),
    zoom: Math.round(zoom * 100) / 100,
  };
}

function Screen({
  initial,
  fixture,
}: {
  initial: LedgerView;
  fixture: boolean;
}) {
  const { view, sides, online, linked, act } = useLedger(initial, fixture);
  const rf = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const narrowPane = useSyncExternalStore(onResize, isNarrow, () => false);
  // below NARROW_PANE the map draws its narrow nodes; it is also where the
  // card covers the top of the map instead of its side
  const size = narrowPane ? NARROW : WIDE;

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
  // the side chat shown over the lower half; the others wait as chips
  const [sideId, setSideId] = useState<string | null>(null);
  // where stepping through a lens got to, for the lens it was on
  const [lensStep, setLensStep] = useState<{ lens: Lens | null; at: number }>({
    lens: null,
    at: -1,
  });
  // where the camera was, so the map comes back there after strip-only
  const [camera, setCamera] = useState(() => startAt(initial));

  const items = view.items;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const folded = useCallback(
    (id: string) => folds[id] ?? !!byId.get(id)?.folded,
    [folds, byId],
  );
  const laid = useMemo(
    () => layout(items, folded, size),
    [items, folded, size],
  );
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
  const marked = useMemo(
    () => new Set([...(snap?.ids ?? []), ...newIds(view)]),
    [snap, view],
  );
  // an item that left the map (Not right, or merged) closes its card
  const card = selected ? (byId.get(selected) ?? null) : null;
  const now = nowTopic(items);
  const beside = drawer && width >= SIDE_BY_SIDE;
  // a side chat you ended (here or on another page) is no longer shown
  const side =
    sideId && view.sides.some((x) => x.id === sideId)
      ? (sides[sideId] ?? null)
      : null;
  const otherSides = view.sides.filter((x) => x.id !== side?.id);
  // what the lens lights up, in map order, for its stepper
  const lensIds = useMemo(() => {
    if (!lens) return [];
    const m = matcher(lens, changed);
    return order.filter((id) => {
      const i = byId.get(id);
      return !!i && i.type !== "topic" && m(i);
    });
  }, [lens, changed, order, byId]);
  const lensAt = lensStep.lens === lens ? lensStep.at : -1;
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
    (id: string, l: Layout, withCard: boolean, sheet = false) => {
      const p = l.nodes.get(id);
      if (!p) return;
      const zoom = clampZoom(rf.getZoom());
      const narrow = width < NARROW_PANE;
      // with the card open, the item lands beside it (and the list), not
      // under it; with a side chat open, in the half above it
      const dx =
        withCard && !narrow ? (CARD_W + (beside ? DRAWER_W : 0)) / 2 / zoom : 0;
      const dy = sheet
        ? -(height * 0.25) / zoom
        : withCard && narrow
          ? (height * 0.25) / zoom
          : 0;
      void rf.setCenter(p.x + size.w / 2 + dx, p.y + size.h / 2 - dy, {
        zoom,
        duration: 300,
      });
    },
    [rf, width, height, beside, size],
  );
  const frameLeft = useCallback(
    (id: string, l: Layout, duration = 300) => {
      const p = l.nodes.get(id);
      if (!p) return;
      const zoom = clampZoom(rf.getZoom());
      void rf.setViewport(
        {
          x: marginX(narrowPane) - p.x * zoom,
          y: marginY(narrowPane, height) - p.y * zoom,
          zoom,
        },
        { duration },
      );
    },
    [rf, height, narrowPane],
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
    return layout(items, (x) => next[x] ?? !!byId.get(x)?.folded, size);
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
    if (p && width < NARROW_PANE && p.y * vp.zoom + vp.y < height * 0.55)
      centre(id, laid, true);
  };

  const stepTo = (to: number) => {
    if (!snap) return;
    const id = snap.ids[to];
    if (!id) return;
    setStep(to);
    pick(id);
  };

  const stepLens = (to: number) => {
    const id = lensIds[to];
    if (!id) return;
    setLensStep({ lens, at: to });
    pick(id);
  };

  // a side chat on an item: the one open on it, or a new one; the item
  // goes to the half above the sheet
  const openSide = async (id: string) => {
    const r = await run({ type: "side-open", item: id });
    if (!r.ok || !r.side) return;
    setSideId(r.side.id);
    setSelected(null);
    setFollowing(false);
    const l = reveal(id);
    centre(id, l, false, true);
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
        else if (sideId) setSideId(null);
        else if (drawer) setDrawer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searching, selected, drawer, sideId]);

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
        onWaitingLens={() => {
          // from the strip alone: the map comes back to show them
          if (compact) {
            setStrip(false);
            setLens("waiting");
          } else setLens(lens === "waiting" ? null : "waiting");
        }}
        waitingLens={lens === "waiting"}
        more={more}
      />
      {showSince && snap && (
        <SinceBar
          snap={snap}
          at={step}
          primary={!card && !side}
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
        following={following}
        step={
          lens && !searching
            ? { at: lensAt, n: lensIds.length, onStep: stepLens }
            : undefined
        }
      />
      {/* clipped, not hidden: focus or find-in-page can scroll a hidden box
          sideways, shifting the whole map with no way back */}
      <main className="relative min-h-0 flex-1 overflow-clip">
        <Canvas
          title={view.title}
          items={items}
          laid={laid}
          size={size}
          folded={folded}
          lit={lit}
          newIds={marked}
          selected={selected}
          initial={camera}
          onNode={onNode}
          onPane={() => setSelected(null)}
          onUserMove={() => setFollowing(false)}
          onMoveEnd={setCamera}
        />
        {items.length === 0 && <Empty view={view} />}
        {/* floats over the map, so turning the lens on moves nothing */}
        {lens &&
          counts[lens] === 0 &&
          !(lens === "changed" && view.changes.length > 0) &&
          !searching &&
          !drawer && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-24px)] -translate-x-1/2 truncate rounded-full bg-surface px-3 py-1 text-[12.5px] text-body shadow-md ring-1 ring-line">
              {NONE[lens]}
            </div>
          )}
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
            primary={!side}
            beside={beside}
            half={!!side}
            act={act}
            onPick={pick}
            onAsk={() => void openSide(card.id)}
            onClose={() => setSelected(null)}
          />
        )}
        {side ? (
          <SideSheet
            key={side.id}
            side={side}
            item={byId.get(side.item) ?? null}
            others={otherSides}
            primary
            act={run}
            onItem={(id) => pick(id)}
            onOpen={(id) => void openSide(id)}
            onHide={() => setSideId(null)}
          />
        ) : (
          otherSides.length > 0 && (
            <div className="absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-24px)] gap-1 overflow-x-auto [scrollbar-width:none]">
              {otherSides.map((o) => (
                <Chip
                  key={o.id}
                  side={o}
                  onOpen={() => void openSide(o.item)}
                  onClose={() => void run({ type: "side-close", side: o.id })}
                />
              ))}
            </div>
          )
        )}
        <Drawer
          open={drawer}
          items={items}
          changes={view.changes}
          changesFirst={changesFirst}
          selected={selected}
          newIds={marked}
          onPick={(id) => {
            // without room for the card beside it, the list steps aside
            if (width < SIDE_BY_SIDE) setDrawer(false);
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
