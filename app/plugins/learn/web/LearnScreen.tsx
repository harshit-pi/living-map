import { useState } from "react";

import { BuildScreen } from "./BuildScreen.tsx";
import { DiagramView } from "./DiagramView.tsx";
import { PathRail } from "./PathRail.tsx";
import { ScenePlay } from "./ScenePlay.tsx";
import { nextOpenStep, nextStep } from "./steps.ts";
import { learnView } from "./view.ts";
import { FloatingComposer } from "../../../web/components/FloatingComposer.tsx";
import { NodePanel } from "../../../web/components/NodePanel.tsx";
import { act } from "../../../web/lib/api.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";

const BUILDING = "Building a playable scene";

// Learn: a build map (every new one) gets the build screen; a map from
// before build mode keeps the classic one, exactly as it was, with one way
// out: Practise this as builds.
export function LearnScreen({ ws }: { ws: Workspace }) {
  const view = learnView(ws.map);
  return view ? (
    <BuildScreen key={ws.map.id} ws={ws} view={view} />
  ) : (
    <ClassicScreen ws={ws} />
  );
}

// Classic Learn: the path on the left; in the middle the topic diagram, or
// the selected step played by hand; the step's panel on the right.
function ClassicScreen({ ws }: { ws: Workspace }) {
  const { map, live, selection, setSelection, roomy } = ws;
  const [centre, setCentre] = useState<"play" | "topic">("play");
  // in a narrow window the board needs the room: the panel tucks away while you play
  const [panelOpen, setPanelOpen] = useState(roomy);

  // a newly selected step opens on its scene, with the panel as wide windows show it
  const [shownFor, setShownFor] = useState(selection.join());
  if (shownFor !== selection.join()) {
    setShownFor(selection.join());
    setCentre("play");
    setPanelOpen(roomy);
  }

  const one = selection.length === 1 ? map.nodes[selection[0]] : undefined;
  const step = one?.parent ? one : undefined;
  const scene = step ? map.scenes[step.id] : undefined;
  const building =
    !!step &&
    live.working?.nodeId === step.id &&
    live.working.label === BUILDING;
  const tucked = !!scene && centre === "play" && !roomy && !panelOpen;
  const playable =
    !!step && step.kind === "question" && !/^write it/i.test(step.title);

  // a clicked part of the diagram opens as a node, explained the first time
  const openPart = async (anchor: string, label: string) => {
    const r = await ws.run({ type: "focus", anchor, label });
    if (!r.nodeId) return;
    setSelection([r.nodeId]);
    if (!map.nodes[r.nodeId]?.detail)
      void ws.run({ type: "explain", nodeId: r.nodeId });
  };

  // each blank's own verdict: its latest tagged reply, or the live text while it is checked
  const verdicts: Record<string, string> = {};
  for (const c of map.chat) if (c.blankId) verdicts[c.blankId] = c.text;
  const verdict = (id: string) =>
    live.working?.blankId === id ? live.stream.text : (verdicts[id] ?? "");
  // once the diagram is done, the first open step is where to go
  const nextId = nextOpenStep(map);
  const nextAfterDiagram = nextId
    ? { title: map.nodes[nextId].title, go: () => setSelection([nextId]) }
    : null;
  const select = (id: string) =>
    setSelection((s) => (s.length === 1 && s[0] === id ? [] : [id]));

  return (
    <div className="flex h-full">
      <PathRail
        map={map}
        selected={one?.id ?? null}
        onSelect={select}
        busy={live.busy}
        workingId={live.working?.nodeId ?? null}
        onNext={() => {
          const n = nextOpenStep(map, one?.id);
          if (n) setSelection([n]);
        }}
        footer={
          <button
            onClick={() => {
              void ws.run({
                type: "plugin",
                plugin: "learn",
                name: "practise",
              });
            }}
            title="Each step becomes a small model you see once and build back from memory; the topic diagram stays"
            className="w-full rounded-lg border border-line-strong py-1.5 text-[12.5px] text-body hover:border-primary hover:text-primary-strong"
          >
            Practise this as builds
          </button>
        }
      />
      <div className="relative min-w-0 flex-1">
        <div
          className="flex h-full flex-col transition-[padding]"
          style={{ paddingRight: one && roomy ? 440 : 0 }}
        >
          {step && (scene || building || playable) && (
            <div className="relative flex items-center justify-center gap-2 pt-3">
              {tucked && (
                <button
                  onClick={() => setPanelOpen(true)}
                  className="absolute top-3 right-3 rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs text-body hover:border-primary"
                >
                  💬 Hints &amp; thread
                </button>
              )}
              {scene ? (
                <div className="flex rounded-lg bg-panel p-0.5 text-[13px]">
                  {(
                    [
                      ["play", "▶ Play this step"],
                      ["topic", "◧ Topic diagram"],
                    ] as const
                  ).map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setCentre(v)}
                      className={`rounded-md px-3 py-1 ${centre === v ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink"}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              ) : building ? (
                <div className="animate-pulse rounded-full bg-primary-soft px-4 py-1.5 text-sm text-primary-strong ring-1 ring-primary-line">
                  Building a playable scene for this step…
                </div>
              ) : (
                <button
                  onClick={() => {
                    void ws.run({ type: "scene", nodeId: step.id });
                  }}
                  className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-on-primary shadow-xs hover:bg-primary-strong"
                >
                  ▶ Play this step by hand
                </button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1">
            {scene && step && centre === "play" ? (
              <ScenePlay
                scene={scene}
                stepTitle={step.title}
                busy={live.busy}
                building={building}
                onKey={(key) =>
                  act({ type: "play", nodeId: step.id, key }, ws.settings)
                }
                onShow={() => {
                  void ws.run({ type: "playshow", nodeId: step.id });
                }}
                onReplay={() => {
                  void ws.run({ type: "replay", nodeId: step.id });
                }}
                onHint={() => {
                  void ws.run({ type: "hint", nodeId: step.id });
                }}
                onNext={() => {
                  const n = nextStep(map, step.id);
                  if (n) setSelection([n]);
                }}
              />
            ) : (
              <div className="h-full" onClick={() => setSelection([])}>
                <DiagramView
                  diagram={map.diagram}
                  fills={map.fills}
                  busy={live.busy}
                  verdict={verdict}
                  next={nextAfterDiagram}
                  openId={one?.anchor ?? null}
                  onOpen={(anchor, label) => {
                    void openPart(anchor, label);
                  }}
                  onFill={(blankId, text) => {
                    void ws.run({ type: "fill", blankId, text });
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          {one && !tucked && (
            <NodePanel
              map={map}
              node={one}
              busy={live.busy}
              working={live.working}
              waiting={live.waiting}
              stream={live.stream}
              settings={ws.settings}
              onSettings={ws.onSettings}
              run={ws.run}
              onSelect={(id) => setSelection([id])}
              onClose={() =>
                scene && !roomy ? setPanelOpen(false) : setSelection([])
              }
              asSteps
            />
          )}
          <FloatingComposer
            ws={ws}
            placeholder="Ask anything about the topic, or tell Claude where you are stuck…"
          />
        </div>
      </div>
    </div>
  );
}
