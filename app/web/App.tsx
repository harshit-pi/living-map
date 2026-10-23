import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { Action, Purpose, Settings } from "../shared/model.ts";
import { Mark } from "./components/Logo.tsx";
import { MapsMenu } from "./components/MapList.tsx";
import { Segmented } from "./components/Segmented.tsx";
import { UpdateButton } from "./components/UpdateButton.tsx";
import { WorkingBar, WorkingPill } from "./components/WorkingBar.tsx";
import { act, useUpdate } from "./lib/api.ts";
import { useLiveMap } from "./lib/live.ts";
import { store, stored } from "./lib/storage.ts";
import type { Workspace } from "./lib/workspace.ts";
import { modeOf, PLUGINS, pluginFor } from "./plugins.ts";
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
  const update = useUpdate();
  const { map } = live;
  const roomy = useRoomy();
  const [selection, setSelection] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  // a new map on its way: the map it replaces, so the loading screen shows
  // until the new one lands, and its mode (the question it asks meanwhile)
  const [launch, setLaunch] = useState<{
    from: string | null;
    purpose: Purpose;
  } | null>(null);
  // what you answered on the loading screen, sent once the new map exists
  // (`from`: the map it replaced): asked at once, it never waits for Claude
  const [held, setHeld] = useState<{
    action: Action;
    from: string | null;
  } | null>(null);
  const sentHeld = useRef<typeof held>(null);
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
  // a refusal is read once and goes: kept on screen, "Those two are already
  // linked that way" stayed over everything you did after it
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 6000);
    return () => clearTimeout(t);
  }, [error]);
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
  // once, after the new map's first view: refused (the map not ready for
  // it), the map asks again as it would have
  const heldFor =
    held && !launch && map && map.id !== held.from && hasContent ? held : null;
  useEffect(() => {
    if (!heldFor || sentHeld.current === heldFor) return;
    sentHeld.current = heldFor;
    void run(heldFor.action);
  }, [heldFor, run]);
  // a map opened from elsewhere (your conversation linked one, or another
  // tab) replaces the start screen you had open
  const [shownId, setShownId] = useState(map?.id ?? null);
  if ((map?.id ?? null) !== shownId) {
    setShownId(map?.id ?? null);
    if (shownId !== null && map) setStarting(false);
  }
  // a node that disappears (removed by Claude) closes its panel
  if (map && selection.some((id) => !map.nodes[id]))
    setSelection((s) => s.filter((id) => map.nodes[id]));

  const openMap = async (mapId: string) => {
    setSelection([]);
    const r = await act({ type: "open", mapId }, settings);
    if (r.error) setStartError(r.error);
    else setStarting(false);
  };

  if (launch || (!starting && !hasContent && live.busy)) {
    const Waiting = launch ? pluginFor(launch.purpose)?.Waiting : undefined;
    return (
      <LoadingScreen live={live} onStop={stop}>
        {Waiting && launch && (
          <Waiting
            held={held?.from === launch.from ? held.action : null}
            hold={(action) => setHeld({ action, from: launch.from })}
          />
        )}
      </LoadingScreen>
    );
  }

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
          setLaunch({ from: map?.id ?? null, purpose });
          setHeld(null);
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
  // every mode is a plugin with its own screen
  const plugin = modeOf(map.purpose);
  const switching = live.busy || !!live.working || live.waiting.length > 0;
  // the modes this map can switch between (Explore and Learn share their map)
  const switches = PLUGINS.filter(
    (p) =>
      p.id === map.purpose ||
      p.switchesWith?.includes(map.purpose) ||
      pluginFor(map.purpose)?.switchesWith?.includes(p.id),
  );
  const simple = !!plugin.simple;
  const startNew = () => {
    setStartError("");
    setStarting(true);
  };
  const modes: [string, string][] = switches
    .map((p): [string, string, number] => [p.id, p.label, p.order ?? 50])
    .sort((a, b) => a[2] - b[2])
    .map(([id, label]) => [id, label]);

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* the title keeps some room while the working pill shows: the pill
          truncates first */}
      {/* in a narrow window (a pane beside your chat) the title takes a row
          of its own, above the controls */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2 sm:grid-cols-[minmax(min(160px,20%),1fr)_minmax(0,auto)_auto]">
        <div className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
          <Mark size={22} className="shrink-0" />
          <div
            className="truncate text-[15px] font-semibold text-ink"
            data-content
          >
            {map.title}
          </div>
          {map.linked && (
            <span
              title={`Linked to your conversation "${map.linked.title}": every move reads it first`}
              // beside a chat the window is narrow: the title keeps the room
              className="hidden shrink-0 rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted md:inline-block"
            >
              From your chat
            </span>
          )}
        </div>
        <div className="flex min-w-0 justify-end">
          <WorkingPill
            working={live.working}
            queued={live.queued}
            onStop={stop}
            compact={simple}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          {modes.length > 1 ? (
            // off while a move runs or waits: switched late, the screen
            // changed under the pointer and the next click landed on
            // Explore's Next, a paid move
            <Segmented
              value={map.purpose}
              options={modes}
              disabled={switching}
              title={
                switching
                  ? "Claude is working: switch once the map settles"
                  : undefined
              }
              onChange={(purpose) => {
                if (!switching) void run({ type: "purpose", purpose });
              }}
            />
          ) : (
            <span className="rounded-lg bg-panel px-3 py-1 text-[13px] text-ink">
              {plugin.label}
            </span>
          )}
          {plugin.Header && <plugin.Header ws={ws} />}
          {!simple && <UpdateButton steps={live.updateSteps} update={update} />}
          {/* the simpler header keeps the update inside Maps, a dot on it
              saying one is out */}
          <MapsMenu
            onOpen={(id) => {
              void openMap(id);
            }}
            onNew={simple ? startNew : undefined}
            update={
              simple ? (
                <UpdateButton steps={live.updateSteps} update={update} inMenu />
              ) : undefined
            }
            dot={simple && !!update.info?.available}
          />
          {!simple && (
            <button
              onClick={startNew}
              className="rounded-lg border border-line-strong px-2.5 py-1.5 text-sm text-body hover:bg-panel"
            >
              New
            </button>
          )}
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
        <plugin.Screen ws={ws} />
      </main>
    </div>
  );
}
