import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { Action, Purpose, Settings } from "../shared/model.ts";
import { Mark } from "./components/Logo.tsx";
import { MapsMenu } from "./components/MapList.tsx";
import { Segmented } from "./components/Segmented.tsx";
import { UpdateButton } from "./components/UpdateButton.tsx";
import { WorkingBar, WorkingPill } from "./components/WorkingBar.tsx";
import { act } from "./lib/api.ts";
import { setAside } from "./lib/layout.ts";
import { useLiveMap } from "./lib/live.ts";
import { store, stored } from "./lib/storage.ts";
import type { Workspace } from "./lib/workspace.ts";
import { pluginFor } from "./plugins.ts";
import { ExploreScreen } from "./screens/ExploreScreen.tsx";
import { LearnScreen } from "./screens/LearnScreen.tsx";
import { LoadingScreen } from "./screens/LoadingScreen.tsx";
import { StartScreen } from "./screens/StartScreen.tsx";

const DEFAULTS: Settings = { model: "", effort: "" };

// on a narrow window the side panel floats over the work instead of pushing
// it aside; followed as the window is resized, not only when the page loads
const isRoomy = () =>
  typeof window !== "undefined" && window.innerWidth >= 1200;
const onResize = (f: () => void) => {
  window.addEventListener("resize", f);
  return () => window.removeEventListener("resize", f);
};
const useRoomy = () => useSyncExternalStore(onResize, isRoomy, () => false);

export default function App() {
  const live = useLiveMap();
  const { map } = live;
  const roomy = useRoomy();
  const [selection, setSelection] = useState<string[]>([]);
  const [showDropped, setShowDropped] = useState(true);
  const [starting, setStarting] = useState(false);
  // a new map on its way: the map it replaces, so the loading screen shows until the new one lands
  const [launch, setLaunch] = useState<{ from: string | null } | null>(null);
  const [startError, setStartError] = useState("");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<Settings>(() => {
    const s = stored<Partial<Settings>>("settings", DEFAULTS);
    return { model: s.model ?? "", effort: s.effort ?? "" };
  });

  const onSettings = useCallback((s: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...s };
      store("settings", next);
      return next;
    });
  }, []);

  const run = useCallback(
    async (a: Action) => {
      const r = await act(a, settings);
      setError(r.error ?? "");
      return r;
    },
    [settings],
  );
  const stop = useCallback(() => {
    void act({ type: "stop" }, settings);
  }, [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // the new map has landed once it has a node or (Learn) its diagram, which is written first
  const hasContent =
    !!map && (Object.keys(map.nodes).length > 0 || !!map.diagram);
  if (launch && map && map.id !== launch.from && hasContent) setLaunch(null);
  // a node that disappears (removed by Claude) closes its panel
  if (map && selection.some((id) => !map.nodes[id]))
    setSelection((s) => s.filter((id) => map.nodes[id]));
  // so does one hidden with the set-aside nodes: what you write is then about
  // the whole map, not a node you cannot see
  const hidden = (id: string) =>
    !!map && map.purpose === "explore" && setAside(map.nodes, id);
  if (!showDropped && selection.some(hidden))
    setSelection((s) => s.filter((id) => !hidden(id)));

  const openMap = async (mapId: string) => {
    setSelection([]);
    const r = await act({ type: "open", mapId }, settings);
    if (r.error) setStartError(r.error);
    else setStarting(false);
  };

  if (launch || (!starting && !hasContent && live.busy))
    return <LoadingScreen live={live} onStop={stop} />;

  if (starting || !hasContent || !map)
    return (
      <StartScreen
        error={startError}
        // a move still running on the open map stops when another one starts
        working={hasContent && live.busy ? (live.working?.label ?? "") : null}
        onCancel={hasContent ? () => setStarting(false) : undefined}
        onOpen={(id) => {
          void openMap(id);
        }}
        onStart={async (text: string, purpose: Purpose) => {
          setStartError("");
          setSelection([]);
          setLaunch({ from: map?.id ?? null });
          setStarting(false);
          const r = await act({ type: "new", text, purpose }, settings);
          // stopped or nothing drawn: back to the start screen, never a spinner forever
          if (r.error || r.stopped) {
            setLaunch(null);
            setStarting(true);
            setStartError(r.error ?? "");
          }
        }}
      />
    );

  const ws: Workspace = {
    live,
    map,
    settings,
    onSettings,
    run,
    showError: setError,
    stop,
    selection,
    setSelection,
    roomy,
  };
  const learn = map.purpose === "learn";
  // a plugin's map has its own screen and a fixed mode
  const plugin = pluginFor(map.purpose);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto] items-center gap-3 border-b border-line px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Mark size={22} className="shrink-0" />
          <div className="truncate text-[15px] font-semibold text-ink">
            {map.title}
          </div>
        </div>
        <div className="flex min-w-0 justify-end">
          <WorkingPill
            working={live.working}
            queued={live.queued}
            onStop={stop}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          {plugin ? (
            <span className="rounded-lg bg-panel px-3 py-1 text-[13px] text-ink">
              {plugin.label}
            </span>
          ) : (
            <Segmented
              value={map.purpose}
              options={[
                ["explore", "Explore"],
                ["learn", "Learn"],
              ]}
              onChange={(purpose) => {
                void run({ type: "purpose", purpose });
              }}
            />
          )}
          {!learn && !plugin && (
            <label className="flex items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                checked={showDropped}
                onChange={(e) => setShowDropped(e.target.checked)}
              />{" "}
              Set aside
            </label>
          )}
          {!learn && !plugin && (
            <button
              onClick={() => {
                void run({ type: "next" });
              }}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40"
            >
              Next ▸
            </button>
          )}
          <UpdateButton steps={live.updateSteps} />
          <MapsMenu
            onOpen={(id) => {
              void openMap(id);
            }}
          />
          <button
            onClick={() => {
              setStartError("");
              setStarting(true);
            }}
            className="rounded-lg border border-line-strong px-2.5 py-1.5 text-sm text-body hover:bg-panel"
          >
            New
          </button>
        </div>
      </header>
      <WorkingBar
        working={live.working}
        queued={live.queued}
        onStop={stop}
        pill={false}
      />
      {!live.online && (
        <div className="bg-warning-soft px-4 py-1.5 text-sm text-warning-strong">
          Lost the connection to the Living Map server; reconnecting…
        </div>
      )}
      <main className="relative min-h-0 flex-1">
        {/* floats over the top of the work, so nothing below it moves */}
        {error && (
          <div className="absolute top-2 left-1/2 z-40 flex max-w-[min(560px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-lg bg-warning-soft px-3 py-1.5 text-sm text-warning-strong shadow-md ring-1 ring-warning-line">
            <span className="min-w-0 flex-1">{error}</span>
            <button
              onClick={() => setError("")}
              className="shrink-0 text-warning-strong"
            >
              ×
            </button>
          </div>
        )}
        {plugin ? (
          <plugin.Screen ws={ws} />
        ) : learn ? (
          <LearnScreen ws={ws} />
        ) : (
          <ExploreScreen ws={ws} showDropped={showDropped} />
        )}
      </main>
    </div>
  );
}
