import { ReactFlowProvider } from "@xyflow/react";
import { useState } from "react";

import { BuildCanvas, SmallBtn, type WhatIfMode } from "./BuildCanvas.tsx";
import { CheckCard, CheckFindings } from "./CheckCard.tsx";
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
  inDays,
  moving,
  stepNumber,
  topSteps,
  useLearnAct,
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
  "Drawing the next step",
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

// what is due on a step is its key links: "3 due for review" under one
// step read as three steps, beside "1 step is due"
const dueWord = (n: number) =>
  `due for review · ${n} key ${n === 1 ? "link" : "links"}`;

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
  // a step part way through its optional new case is built: what is due
  // comes first
  if (st.onCase && st.itemsDue > 0)
    return {
      mark: "↻",
      cls: "border-primary bg-surface text-primary-strong",
      word: `${dueWord(st.itemsDue)} · new case open`,
      meter,
    };
  if (st.stage === "built")
    return due
      ? {
          mark: "↻",
          cls: "border-primary bg-surface text-primary-strong",
          word: st.recallDue ? "quick rebuild waiting" : dueWord(st.itemsDue),
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
  const { act, busy, pending } = useLearnAct(ws.run, moving(live));
  const here: Here = { ws, view, busy, act, pending };
  const [onPath, setOnPath] = useState(false);
  // the step last on screen when you had not picked one: a step stays in
  // view when it is built, so its Why verdict, What if and New case are
  // seen, until you go on (Next step, the rail)
  const [pinned, setPinned] = useState<string | null>(null);
  const [centre, setCentre] = useState<"step" | "topic" | "play">("step");
  const [thread, setThread] = useState(false);
  const [whatifOn, setWhatifOn] = useState(false);
  // the what-if's marks are drawn on the build you clicked them on, right
  // after its check: drawn again on a later rebuild, they marked parts of a
  // build that never had them
  const [wiShown, setWiShown] = useState(false);
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
      find(pinned) ??
      tops.find((s) => s.stage !== "built") ??
      tops.find((s) => s.recallDue) ??
      tops[0]);
  if (current && !selStep && pinned !== current.step) setPinned(current.step);

  // a different step starts on its own canvas, with nothing half-done. A
  // play step not yet built opens on its scene, which comes first (spec §1):
  // "I know some" skipped See, and the step opened on Build the order. Its
  // mode is known once its model is in, so that counts as a new key too.
  const key = current ? `${current.step}:${current.mode}` : "";
  // empty at first, so the step the map opens on starts the same way
  const [shownFor, setShownFor] = useState("");
  if (shownFor !== key) {
    setShownFor(key);
    setCentre(
      current?.mode === "play" &&
        (current.stage === "see" ||
          (current.stage === "build" && current.checks === 0))
        ? "play"
        : "step",
    );
    setThread(false);
  }
  // a new stage of the step (a rebuild started or done) starts the what-if
  // afresh too
  const wiKey = `${key}:${current?.stage}:${current?.recall}:${current?.reviewing}`;
  const [wiFor, setWiFor] = useState(wiKey);
  if (wiFor !== wiKey) {
    setWiFor(wiKey);
    setWhatifOn(false);
    setWiShown(false);
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
    (!!current &&
      !!w?.label.startsWith(NEW_CASE) &&
      w.nodeId === current.step) ||
    pending("newCase");

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
          Due: {view.due.now} {view.due.now === 1 ? "step" : "steps"} now
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
      {/* a narrow window stacks the parts, the canvas and the side card,
          so the canvas keeps its width (at 1024 side by side, the canvas
          was 394 wide and the worked case shrank to 4px words); from 1024
          the parts go over the canvas and the side card stays beside it
          (stacked at 1024×700, Check sat below the fold) */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-visible">
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
            wiShown={wiShown}
            setWiShown={setWiShown}
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
  wiShown,
  setWiShown,
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
  wiShown: boolean;
  setWiShown: (on: boolean) => void;
  picked: string[];
  setPicked: (f: (p: string[]) => string[]) => void;
  wiSure: Sure | null;
  setWiSure: (s: Sure) => void;
  setWhatifOn: (on: boolean) => void;
  onThread: () => void;
  onPick: (id: string) => void;
  onNext: (() => void) | null;
}) {
  const { ws, view, busy, act, pending } = here;
  const { map, live } = ws;
  const mode = canvasMode(st);
  // Draw this step at once looks under way: the move takes a moment to start
  const drawing = writing || pending("open", { step: st.step });
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
    st.stage === "built" && st.whatif && (whatifOn || (wiResult && wiShown))
      ? {
          picked: wiResult ? [] : picked,
          toggle: (part) =>
            !wiResult &&
            setPicked((p) =>
              p.includes(part) ? p.filter((x) => x !== part) : [...p, part],
            ),
          found: wiResult?.found ?? [],
          extra: wiResult?.extra ?? [],
          missed: wiResult?.missed ?? [],
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

  // a review whose rebuilds are all done says so first: under the step's
  // old Why and its extras, its result sat below the fold
  const reviewDone = !!review && !view.steps.some((s) => s.reviewing);

  const side = (
    <aside className="flex max-h-[45%] w-full shrink-0 flex-col overflow-y-auto border-t border-line bg-surface px-4 py-3 lg:max-h-none lg:w-[260px] lg:border-t-0 lg:border-l xl:w-[280px] 2xl:w-[300px]">
      <div className="space-y-4">
        {review && reviewDone && (
          <div className="border-b border-line pb-3">
            <ReviewPanel here={here} review={review} />
          </div>
        )}
        {/* a quick rebuild that passed says so first: the card went
            straight back to the step's old Why, as if nothing had happened */}
        {ready && st.stage === "built" && st.recalled && (
          <div className="rounded-lg bg-success-soft px-2.5 py-1.5 text-[13px] font-medium text-success-strong">
            ↻ Quick rebuild ✓ · {CREDIT[st.recalled.credit].word}
            {st.recalled.tries > 1 ? ` · on try ${st.recalled.tries}` : ""}
          </div>
        )}
        {ready && st.stage === "see" && (
          <PredictCard key={st.step} here={here} st={st} />
        )}
        {ready && st.stage === "build" && <CheckCard here={here} st={st} />}
        {/* a check that passed goes on to the Why: what it found (a
            mix-up's refutation, a "?" to argue for, the order) stays here */}
        {ready && (st.stage === "why" || st.stage === "built") && st.check && (
          <CheckFindings key={`${st.step}:check`} here={here} st={st} passed />
        )}
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
              checked: () => setWiShown(true),
            }}
            onWhatIf={() => setWhatifOn(true)}
            onNext={onNext}
          />
        )}
        {review && !reviewDone && (
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
        nextLabel={
          st.stage === "built" ? "Back to the order ▸" : "Build the order ▸"
        }
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
            <div className="mt-1 text-[12px] text-muted">
              It was asked once more and still did not. Try again draws it
              afresh.
            </div>
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
        ) : drawing ? (
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
      <ReactFlowProvider
        key={`${st.step}:${mode === "worked" ? "worked" : "own"}`}
      >
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
      {/* stacked (under 1024 wide), this keeps its own height and the side
          card scrolls in under it: let shrink to fit, the canvas ran past
          its end and the message box sat on the check card's heading */}
      <div className="flex min-w-0 flex-none flex-col lg:min-h-0 lg:flex-1 xl:flex-row">
        {ready && mode === "build" && centre === "step" && (
          <Tray here={here} st={st} />
        )}
        {/* stacked (under 1024 wide), the canvas keeps a height of its own
          and the side card follows below it: squeezed to fit, the build had
          about 170px between its header and the message box */}
        <div className="relative flex min-h-[540px] min-w-0 flex-1 flex-col lg:min-h-[360px]">
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
            {ready &&
              st.worked &&
              centre === "step" &&
              (st.caseTitle || st.case) && (
                <div className="text-[11.5px] text-muted">
                  <span className="font-semibold tracking-wide text-faint uppercase">
                    Worked case
                  </span>{" "}
                  ·{" "}
                  {/* the case's name, then what happens in it: joined by a
                  comma they read as one run-on line */}
                  {st.caseTitle && (
                    <span className="font-medium text-body">
                      {st.caseTitle}
                    </span>
                  )}
                  {st.caseTitle && st.case && " — "}
                  {st.case}
                </div>
              )}
            {/* while you build, the case's name stays in view: a sort
                step's columns weigh evidence for a claim, and the claim was
                said only on the See you skipped ("The case against Germany,
                1914"). The server leaves it out where it names a part you
                are to recall. */}
            {ready &&
              mode === "build" &&
              centre === "step" &&
              !st.onCase &&
              st.caseTitle && (
                <div className="text-[11.5px] text-muted">
                  <span className="font-semibold tracking-wide text-faint uppercase">
                    Case
                  </span>{" "}
                  · <span className="text-body">{st.caseTitle}</span>
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
            {ready && st.onCase && st.stage === "build" && (
              <button
                onClick={() => void act("onCase", { step: st.step, on: false })}
                className="text-[11.5px] text-muted hover:text-ink"
                title="The new case is optional: it waits here for you"
              >
                ← Back to my build (the new case waits)
              </button>
            )}
          </div>
          <div className="relative min-h-0 flex-1">{body}</div>
          <FloatingComposer
            ws={ws}
            beside={false}
            sticky
            placeholder="Ask anything about the topic, or tell Claude where you are stuck…"
          />
        </div>
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
