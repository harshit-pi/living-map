import { useCallback, useEffect, useState } from "react";

import type { Action, Purpose, Settings } from "../shared/model.ts";
import { MapsMenu } from "./components/MapList.tsx";
import { Segmented } from "./components/Segmented.tsx";
import { WorkingBar } from "./components/WorkingBar.tsx";
import { act } from "./lib/api.ts";
import { useLiveMap } from "./lib/live.ts";
import { store, stored } from "./lib/storage.ts";
import type { Workspace } from "./lib/workspace.ts";
import { ExploreScreen } from "./screens/ExploreScreen.tsx";
import { LearnScreen } from "./screens/LearnScreen.tsx";
import { LoadingScreen } from "./screens/LoadingScreen.tsx";
import { StartScreen } from "./screens/StartScreen.tsx";

const DEFAULTS: Settings = { model: "", effort: "" };

// on a narrow window the side panel floats over the work instead of pushing it aside
const isRoomy = () =>
  typeof window !== "undefined" && window.innerWidth >= 1200;

export default function App() {
  const live = useLiveMap();
  const { map } = live;
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
          if (r.error) {
            setLaunch(null);
            setStarting(true);
            setStartError(r.error);
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
    stop,
    selection,
    setSelection,
    roomy: isRoomy(),
  };
  const learn = map.purpose === "learn";

  return (
    <div className="flex h-full flex-col bg-cl-bg">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-cl-line px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-cl-ink">
            {map.title}
          </div>
        </div>
        <div />
        <div className="flex items-center justify-end gap-2">
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
          {!learn && (
            <label className="flex items-center gap-1 text-xs text-cl-mute">
              <input
                type="checkbox"
                checked={showDropped}
                onChange={(e) => setShowDropped(e.target.checked)}
              />{" "}
              Set aside
            </label>
          )}
          {!learn && (
            <button
              onClick={() => {
                void run({ type: "next" });
              }}
              disabled={live.busy}
              className="rounded-lg bg-cl-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-cl-accentDk disabled:opacity-40"
            >
              Next ▸
            </button>
          )}
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
            className="rounded-lg border border-cl-line2 px-2.5 py-1.5 text-sm text-cl-text hover:bg-cl-panel"
          >
            New
          </button>
        </div>
      </header>
      <WorkingBar working={live.working} queued={live.queued} onStop={stop} />
      {!live.online && (
        <div className="bg-amber-50 px-4 py-1.5 text-sm text-amber-900">
          Lost the connection to the Living Map server; reconnecting…
        </div>
      )}
      {error && (
        <div className="flex items-center bg-amber-50 px-4 py-1.5 text-sm text-amber-900">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")} className="text-amber-700">
            ×
          </button>
        </div>
      )}
      <main className="relative min-h-0 flex-1">
        {learn ? (
          <LearnScreen ws={ws} />
        ) : (
          <ExploreScreen ws={ws} showDropped={showDropped} />
        )}
      </main>
    </div>
  );
}
