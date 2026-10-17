import { ReactFlowProvider } from "@xyflow/react";
import { useState } from "react";

import { BuildCanvas, SmallBtn, type WhatIfMode } from "./BuildCanvas.tsx";
import { CheckCard } from "./CheckCard.tsx";
import { DiagramView } from "./DiagramView.tsx";
import { PathRail, type RailMark } from "./PathRail.tsx";
import { ReviewPanel, ReviewStart, ReviewStrip } from "./ReviewPanel.tsx";
import { ScenePlay } from "./ScenePlay.tsx";
import { LevelChooser, PredictCard, StageStrip } from "./StepTop.tsx";
import { Tray } from "./Tray.tsx";
import {
  canvasMode,
  CREDIT,
  creditCls,
  guardedAct,
  inDays,
  moving,
  stepNumber,
  topSteps,
  WAIT_TITLE,
  type Here,
} from "./view.ts";
import { BuiltCard, WhyCard } from "./WhyCard.tsx";
import { FloatingComposer } from "../../../web/components/FloatingComposer.tsx";
import { NodePanel } from "../../../web/components/NodePanel.tsx";
import { act as send } from "../../../web/lib/api.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import {
  RUNGS,
  type LearnView,
  type Rung,
  type StepView,
  type Sure,
} from "../shared.ts";

// the labels of the server's moves, as the working pill shows them
// (plugins/learn/build.ts)
const DRAWING = [
  "Drawing this step",
  "Drawing your path and step 1",
  "Turning this into a learning path",
];
const JUDGING = "Reading your why";
const NEW_CASE = "Writing a new case";
const BUILDING_SCENE = "Building a playable scene";

const RUNG_WORD: Record<Rung, string> = {
  built: "Built",
  why: "Why",
  whatif: "What if",
  case: "New case",
  kept: "Kept",
};

function railMark(st: StepView): RailMark {
  const meter = RUNGS.map((r) => {
    const c = st.rungs[r];
    return {
      sym: c ? CREDIT[c].sym : "·",
      cls: creditCls(c),
      title: `${RUNG_WORD[r]}: ${c ? CREDIT[c].word : "not yet"}`,
    };
  });
  const due = st.itemsDue > 0 || st.recallDue;
  if (st.model === "none" || st.model === "writing")
    return {
      mark: "",
      cls: "border-warning bg-surface text-warning-strong",
      word: st.model === "writing" ? "being drawn" : "to do",
      meter,
    };
  if (st.model === "broken")
    return {
      mark: "!",
      cls: "border-danger bg-danger-soft text-danger-strong",
      word: "did not hold together",
      meter,
    };
  if (st.reviewing || st.recall)
    return {
      mark: "↻",
      cls: "border-primary bg-primary-soft text-primary-strong",
      word: st.recall ? "quick rebuild" : "rebuilding",
      meter,
    };
  if (st.stage === "built")
    return due
      ? {
          mark: "↻",
          cls: "border-primary bg-surface text-primary-strong",
          word: st.recallDue
            ? "quick rebuild waiting"
            : `${st.itemsDue} due for review`,
          meter,
        }
      : {
          mark: "✓",
          cls: "border-success bg-success text-on-primary",
          word:
            st.rungs.built === "shown"
              ? "built, shown"
              : st.rungs.built === "hints"
                ? "built with hints"
                : "built by you",
          meter,
        };
  if (st.stage === "why")
    return {
      mark: "",
      cls: "border-warning bg-warning-soft text-warning-strong",
      word: "say why",
      meter,
    };
  if (st.stage === "build")
    return {
      mark: "",
      cls: "border-primary bg-surface text-primary-strong",
      word: st.onCase ? "new case" : `building · L${st.help}`,
      meter,
    };
  return {
    mark: "",
    cls: "border-warning bg-surface text-warning-strong",
    word: st.model === "ready" ? "to see" : "to do",
    meter,
  };
}

// Learn on a build map: the path on the left; the step's tray, canvas and
// side card; Review when something is due.
export function BuildScreen({ ws, view }: { ws: Workspace; view: LearnView }) {
  const { map, live, selection, setSelection } = ws;
  // one guard for every paid move on this screen (view.ts)
  const busy = moving(live);
  const here: Here = { ws, view, busy, act: guardedAct(ws.run, busy) };
  const [onPath, setOnPath] = useState(false);
  const [centre, setCentre] = useState<"step" | "topic" | "play">("step");
  const [thread, setThread] = useState(false);
  const [whatifOn, setWhatifOn] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [wiSure, setWiSure] = useState<Sure | null>(null);

  const find = (id: string | null | undefined) =>
    id ? view.steps.find((s) => s.step === id) : undefined;
  const one = selection.length === 1 ? map.nodes[selection[0]] : undefined;
  const selStep = find(one?.id);
  const review = view.review;
  const reviewNext = review?.order.map(find).find((s) => s?.reviewing);
  const tops = topSteps(view);
  const landing = !selStep && !review && view.due.now > 0 && !onPath;
  const current: StepView | undefined = landing
    ? undefined
    : (selStep ??
      reviewNext ??
      tops.find((s) => s.stage !== "built") ??
      tops.find((s) => s.recallDue) ??
      tops[0]);

  // a different step starts on its own canvas, with nothing half-done
  const key = current?.step ?? "";
  const [shownFor, setShownFor] = useState(key);
  if (shownFor !== key) {
    setShownFor(key);
    setCentre(
      current?.mode === "play" && current.stage === "see" ? "play" : "step",
    );
    setThread(false);
    setWhatifOn(false);
    setPicked([]);
    setWiSure(null);
  }

  const w = live.working;
  const isWriting = (st: StepView) =>
    st.model === "writing" ||
    (!!w &&
      DRAWING.some((l) => w.label.startsWith(l)) &&
      (w.nodeId === st.step || (!w.nodeId && st.step === tops[0]?.step))) ||
    live.waiting.some(
      (x) => x.nodeId === st.step && DRAWING.some((l) => x.label.startsWith(l)),
    );
  const judging =
    !!current && w?.label === JUDGING && w.nodeId === current.step;
  const writingCase =
    !!current && !!w?.label.startsWith(NEW_CASE) && w.nodeId === current.step;

  // a step's model is written the first time you open it (one Claude move)
  const openStep = (id: string) => {
    setSelection([id]);
    setOnPath(true);
    const st = find(id);
    if (st && st.model === "none" && !isWriting(st))
      void here.act("open", { step: id });
  };
  const nextAfter = (id: string | undefined) => {
    const i = tops.findIndex((s) => s.step === id);
    const rest = [...tops.slice(i + 1), ...tops.slice(0, Math.max(0, i))];
    return rest.find((s) => s.stage !== "built") ?? tops[i + 1];
  };
  const goNext = () => {
    const n = nextAfter(current?.step);
    if (n) openStep(n.step);
  };

  const marks: Record<string, RailMark> = {};
  for (const st of view.steps) marks[st.step] = railMark(st);
  // built as the server counts it: the build passed and the why was done
  const built = tops.filter(
    (s) => map.nodes[s.step]?.status === "answered",
  ).length;

  const footer = (
    <div className="text-[12px] text-muted">
      {view.due.now > 0 ? (
        <button
          onClick={() => {
            setSelection([]);
            setOnPath(false);
          }}
          className="font-medium text-primary-strong hover:underline"
        >
          Due: {view.due.now} now
        </button>
      ) : (
        <span>Due: nothing</span>
      )}
      {view.due.next !== null && view.due.now === 0 && (
        <span> · next {inDays(view.due.next, view.now)}</span>
      )}
    </div>
  );

  // the step's own node panel: its thread, Explain, Skip; never Show answer
  // (Show the model is the build's own, and counts as shown)
  const panelNode = one && (!selStep || thread) ? one : undefined;
  const panelActions = panelNode && (
    <>
      {panelNode.dropped ? (
        <SmallBtn
          onClick={() => void ws.run({ type: "restore", nodeId: panelNode.id })}
        >
          Restore
        </SmallBtn>
      ) : (
        <>
          {!panelNode.detail && (
            <SmallBtn
              disabled={busy}
              title={busy ? WAIT_TITLE : "Claude says what it is"}
              onClick={() =>
                !busy && void ws.run({ type: "explain", nodeId: panelNode.id })
              }
            >
              Explain
            </SmallBtn>
          )}
          {panelNode.parent && panelNode.status !== "answered" && (
            <SmallBtn
              onClick={() =>
                void ws.run({ type: "drop", nodeId: panelNode.id })
              }
            >
              {panelNode.kind === "question" ? "Skip this step" : "Remove"}
            </SmallBtn>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="flex h-full">
      <PathRail
        map={map}
        selected={current?.step ?? null}
        onSelect={(id) => (find(id) ? openStep(id) : setSelection([id]))}
        busy={false}
        workingId={live.working?.nodeId ?? null}
        onNext={goNext}
        marks={marks}
        progress={{ got: built, word: "built" }}
        footer={footer}
      />
      <div className="relative flex min-w-0 flex-1">
        {landing ? (
          <div className="relative min-w-0 flex-1">
            <ReviewStart here={here} onPath={() => setOnPath(true)} />
          </div>
        ) : !current ? (
          <div className="flex min-w-0 flex-1 items-center justify-center text-muted">
            {busy ? (
              <span className="animate-pulse">
                Claude is laying out your path…
              </span>
            ) : (
              "No steps yet. Ask for a path below."
            )}
          </div>
        ) : (
          <StepArea
            here={here}
            st={current}
            review={review}
            centre={centre}
            setCentre={setCentre}
            writing={isWriting(current)}
            judging={judging}
            writingCase={writingCase}
            whatifOn={whatifOn}
            picked={picked}
            setPicked={setPicked}
            wiSure={wiSure}
            setWiSure={setWiSure}
            setWhatifOn={setWhatifOn}
            onThread={() => {
              setSelection([current.step]);
              setThread(true);
            }}
            onPick={openStep}
            onNext={nextAfter(current.step) ? goNext : null}
          />
        )}
        <div onClick={(e) => e.stopPropagation()}>
          {panelNode && (
            <NodePanel
              map={map}
              node={panelNode}
              busy={live.busy}
              working={live.working}
              waiting={live.waiting}
              stream={live.stream}
              settings={ws.settings}
              onSettings={ws.onSettings}
              run={ws.run}
              onSelect={(id) => setSelection([id])}
              onClose={() => (selStep ? setThread(false) : setSelection([]))}
              asSteps
              actions={panelActions}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepArea({
  here,
  st,
  review,
  centre: asked,
  setCentre,
  writing,
  judging,
  writingCase,
  whatifOn,
  picked,
  setPicked,
  wiSure,
  setWiSure,
  setWhatifOn,
  onThread,
  onPick,
  onNext,
}: {
  here: Here;
  st: StepView;
  review: LearnView["review"];
  centre: "step" | "topic" | "play";
  setCentre: (c: "step" | "topic" | "play") => void;
  writing: boolean;
  judging: boolean;
  writingCase: boolean;
  whatifOn: boolean;
  picked: string[];
  setPicked: (f: (p: string[]) => string[]) => void;
  wiSure: Sure | null;
  setWiSure: (s: Sure) => void;
  setWhatifOn: (on: boolean) => void;
  onThread: () => void;
  onPick: (id: string) => void;
  onNext: (() => void) | null;
}) {
  const { ws, view, busy, act } = here;
  const { map, live } = ws;
  const mode = canvasMode(st);
  // what the centre shows: the topic diagram only where there is one and you
  // are not building (it may draw the links), the scene only on a play step
  const centre =
    (asked === "topic" && (!view.topic || st.stage === "build")) ||
    (asked === "play" && st.mode !== "play")
      ? "step"
      : asked;
  const ready = st.model === "ready";
  const scene = map.scenes[st.step];
  const buildingScene =
    live.working?.nodeId === st.step && live.working.label === BUILDING_SCENE;
  const first = topSteps(view)[0]?.step === st.step;

  // the what-if: on while you click parts; its result marks them after
  const wiResult = st.stage === "built" ? st.whatif?.result : null;
  const whatif: WhatIfMode | null =
    st.stage === "built" && st.whatif && (whatifOn || wiResult)
      ? {
          picked: wiResult ? [] : picked,
          toggle: (part) =>
            !wiResult &&
            setPicked((p) =>
              p.includes(part) ? p.filter((x) => x !== part) : [...p, part],
            ),
          found: wiResult?.found ?? [],
          extra: wiResult?.extra ?? [],
          fails: st.whatif.fails,
        }
      : null;

  const onDeeper = (part: string) => {
    void act("deeper", { step: st.step, part }).then((r) => {
      if (!r.nodeId) return;
      ws.setSelection([r.nodeId]);
      // its model is written when it is opened: now, as you asked for it.
      // Sent past the guard on purpose: the button was open (nothing ran),
      // and going deeper itself calls no model.
      void ws.run({
        type: "plugin",
        plugin: "learn",
        name: "open",
        args: { step: r.nodeId },
      });
    });
  };

  // the old topic diagram, kept on a map practised as builds
  const verdicts: Record<string, string> = {};
  for (const c of map.chat) if (c.blankId) verdicts[c.blankId] = c.text;

  const side = (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface px-4 py-3">
      <div className="space-y-4">
        {ready && st.stage === "see" && (
          <PredictCard key={st.step} here={here} st={st} />
        )}
        {ready && st.stage === "build" && <CheckCard here={here} st={st} />}
        {ready && (st.stage === "why" || st.stage === "built") && (
          <WhyCard key={st.step} here={here} st={st} judging={judging} />
        )}
        {ready && st.stage === "built" && (
          <BuiltCard
            here={here}
            st={st}
            writingCase={writingCase}
            whatif={{
              on: whatifOn,
              picked,
              sure: wiSure,
              setSure: setWiSure,
              stop: () => {
                setWhatifOn(false);
                setPicked(() => []);
              },
            }}
            onWhatIf={() => setWhatifOn(true)}
            onNext={onNext}
          />
        )}
        {review && (
          <div className="border-t border-line pt-3">
            <ReviewPanel here={here} review={review} />
          </div>
        )}
      </div>
    </aside>
  );

  let body;
  if (centre === "topic")
    body = (
      <DiagramView
        diagram={map.diagram}
        fills={map.fills}
        busy={live.busy}
        verdict={(id) => verdicts[id] ?? ""}
        next={null}
        openId={null}
        onOpen={() => {}}
        onFill={(blankId, text) => {
          void ws.run({ type: "fill", blankId, text });
        }}
      />
    );
  else if (centre === "play")
    body = scene ? (
      <ScenePlay
        scene={scene}
        stepTitle={st.title}
        busy={live.busy}
        building={buildingScene}
        onKey={(key) =>
          send({ type: "play", nodeId: st.step, key }, ws.settings)
        }
        onShow={() => void ws.run({ type: "playshow", nodeId: st.step })}
        onReplay={() => void ws.run({ type: "replay", nodeId: st.step })}
        onNext={() => setCentre("step")}
      />
    ) : (
      <div className="flex h-full items-center justify-center">
        {buildingScene ? (
          <div className="animate-pulse rounded-full bg-primary-soft px-4 py-1.5 text-sm text-primary-strong ring-1 ring-primary-line">
            Building a playable scene for this step…
          </div>
        ) : (
          <SmallBtn
            primary
            disabled={busy}
            title={busy ? WAIT_TITLE : "One Claude move"}
            onClick={() =>
              !busy && void ws.run({ type: "scene", nodeId: st.step })
            }
          >
            ▶ Play this step by hand
          </SmallBtn>
        )}
      </div>
    );
  else if (!ready)
    body = (
      <div className="flex h-full items-center justify-center p-6">
        {st.model === "broken" ? (
          <div className="max-w-sm text-center">
            <div className="text-[15px] font-medium text-ink">
              Claude's model did not hold together
            </div>
            {st.problems.length > 0 && (
              <div className="mt-1 text-[12px] text-muted">
                {st.problems.slice(0, 3).join("; ")}
              </div>
            )}
            <div className="mt-3">
              <SmallBtn
                primary
                disabled={busy}
                title={busy ? WAIT_TITLE : "One Claude move"}
                onClick={() => void act("open", { step: st.step })}
              >
                Try again
              </SmallBtn>
            </div>
          </div>
        ) : writing ? (
          <div className="w-[460px] max-w-[80%] text-center">
            <div className="grid grid-cols-3 items-center gap-6">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`skeleton h-12 ${i % 2 ? "opacity-60" : ""}`}
                />
              ))}
            </div>
            <div className="mt-5 text-sm text-muted">
              Claude is drawing this step on one concrete case…
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-[13px] text-muted">
              This step's model is written when you open it.
            </div>
            <div className="mt-2">
              <SmallBtn
                primary
                disabled={busy}
                title={busy ? WAIT_TITLE : "One Claude move"}
                onClick={() => void act("open", { step: st.step })}
              >
                Draw this step
              </SmallBtn>
            </div>
          </div>
        )}
      </div>
    );
  else
    body = (
      <ReactFlowProvider key={`${st.step}:${mode}`}>
        <BuildCanvas
          here={here}
          st={st}
          mode={mode}
          whatif={whatif}
          onDeeper={onDeeper}
        />
      </ReactFlowProvider>
    );

  return (
    <>
      {ready && mode === "build" && centre === "step" && (
        <Tray here={here} st={st} />
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-line px-4 pt-3 pb-2">
          {review && (
            <ReviewStrip
              view={view}
              review={review}
              current={st.step}
              onPick={onPick}
            />
          )}
          {first &&
            !review &&
            (view.level === null || st.stage !== "built") && (
              <LevelChooser here={here} level={view.level} />
            )}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-ink">
                <span className="mr-1.5 text-muted">
                  {stepNumber(view, st.step)}
                </span>
                {st.title}
              </div>
            </div>
            {st.mode === "play" && (
              <Toggle
                value={centre === "play" ? "play" : "step"}
                options={[
                  ["play", "▶ Play it"],
                  ["step", "◇ Build the order"],
                ]}
                onChange={setCentre}
              />
            )}
            {/* the old diagram may draw the links you are rebuilding: it
                stays out of view while you build */}
            {view.topic && st.stage !== "build" && (
              <Toggle
                value={centre === "topic" ? "topic" : "step"}
                options={[
                  ["step", "This step"],
                  ["topic", "◧ Topic diagram"],
                ]}
                onChange={setCentre}
              />
            )}
            <button
              onClick={onThread}
              className="rounded-lg border border-line-strong px-2.5 py-1 text-xs text-body hover:border-primary"
            >
              💬 Thread
            </button>
          </div>
          {ready && (
            <StageStrip
              st={st}
              skippedSee={
                // the chooser, or Practise this as builds on a step you had
                // worked out, starts it past See
                (view.level === "some" ||
                  view.level === "cold" ||
                  view.topic) &&
                st.help > 0
              }
            />
          )}
          {ready && st.worked && centre === "step" && (
            <div className="text-[11.5px] text-muted">
              <span className="font-semibold tracking-wide text-faint uppercase">
                Worked case
              </span>{" "}
              · {st.caseTitle}
              {st.case && `, ${st.case}`}
            </div>
          )}
          {ready &&
            mode === "build" &&
            centre === "step" &&
            st.help < 3 &&
            st.checks === 0 &&
            !st.reviewing &&
            !st.recall &&
            !st.onCase && (
              <button
                onClick={() => void act("showModel", { step: st.step })}
                className="text-[11.5px] text-muted hover:text-ink"
                title="It counts as shown"
              >
                Peek at the worked case
              </button>
            )}
        </div>
        <div className="relative min-h-0 flex-1">{body}</div>
        <FloatingComposer
          ws={ws}
          beside={false}
          placeholder="Ask anything about the topic, or tell Claude where you are stuck…"
        />
      </div>
      {side}
    </>
  );
}

function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg bg-panel p-0.5 text-[12.5px]">
      {options.map(([v, l]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-0.5 ${value === v ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
