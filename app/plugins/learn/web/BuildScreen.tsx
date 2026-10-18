import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import { BuildCanvas, SmallBtn, type WhatIfMode } from "./BuildCanvas.tsx";
import { CheckCard, CheckFindings } from "./CheckCard.tsx";
import { DiagramView } from "./DiagramView.tsx";
import { PathRail, type RailMark } from "./PathRail.tsx";
import {
  ClosingCard,
  ReviewPanel,
  ReviewStart,
  ReviewStrip,
} from "./ReviewPanel.tsx";
import { ScenePlay } from "./ScenePlay.tsx";
import { LevelCard, PredictCard } from "./StepTop.tsx";
import { Tray } from "./Tray.tsx";
import {
  canvasMode,
  CREDIT,
  helpLine,
  howTo,
  LEVELS,
  moving,
  stepNumber,
  toCarryOn,
  topSteps,
  useLearnAct,
  WAIT_TITLE,
  type Here,
} from "./view.ts";
import { BuiltCard, WhyCard } from "./WhyCard.tsx";
import { FloatingComposer } from "../../../web/components/FloatingComposer.tsx";
import { More, type MoreSection } from "../../../web/components/More.tsx";
import { NodePanel } from "../../../web/components/NodePanel.tsx";
import { act as send } from "../../../web/lib/api.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import {
  countsBuilt,
  type LearnView,
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

// What the rail says under a step: a word only where something is going
// on (drawing, building, done, due); a step still to do says nothing, its
// number is enough.
function railMark(st: StepView): RailMark {
  const due = st.itemsDue > 0 || st.recallDue;
  if (st.model === "none" || st.model === "writing")
    return {
      mark: "",
      cls: "border-warning bg-surface text-warning-strong",
      word: st.model === "writing" ? "drawing" : "",
    };
  if (st.model === "broken")
    return {
      mark: "!",
      cls: "border-danger bg-danger-soft text-danger-strong",
      word: "did not draw",
    };
  if (st.reviewing || st.recall)
    return {
      mark: "↻",
      cls: "border-primary bg-primary-soft text-primary-strong",
      word: st.recall ? "quick rebuild" : "rebuilding",
    };
  // a step part way through its optional new case is built: what is due
  // comes first
  if (st.onCase && st.itemsDue > 0)
    return {
      mark: "↻",
      cls: "border-primary bg-surface text-primary-strong",
      word: "due for review",
    };
  if (st.stage === "built")
    return due
      ? {
          mark: "↻",
          cls: "border-primary bg-surface text-primary-strong",
          // due for review wins: the review rebuilds it, and the quick
          // rebuild goes when it opens
          word: st.itemsDue > 0 ? "due for review" : "quick rebuild",
        }
      : {
          mark: "✓",
          cls: "border-success bg-success text-on-primary",
          word:
            st.rungs.built === "shown"
              ? "done · shown"
              : st.rungs.built === "hints"
                ? "done · with hints"
                : "done",
        };
  if (st.stage === "why")
    return {
      mark: "",
      cls: "border-warning bg-warning-soft text-warning-strong",
      word: "say why",
    };
  if (st.stage === "build")
    return {
      mark: "",
      cls: "border-primary bg-surface text-primary-strong",
      word: st.onCase ? "new example" : "building",
    };
  return {
    mark: "",
    cls: "border-warning bg-surface text-warning-strong",
    word: "",
  };
}

// what a review that closed itself said, kept on the card (`at`: when that
// review opened)
type Closed = {
  at: number;
  unaided: number;
  of: number;
  last: number | null;
  card: { right: boolean; correct: string | null } | null;
};

// a step rebuilt from memory (a review, a quick rebuild): its scene stays
// shut until the rebuild is checked, as the server has it (rebuilding)
const fromMemory = (st: StepView) =>
  st.stage === "build" && (st.reviewing || st.recall);

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
  // a review that has just closed itself: what it said, kept on the card
  // until you go on (the server logs the visit when it closes, so "next
  // review" is the real day)
  const [closed, setClosed] = useState<Closed | null>(null);
  // the review last closed from here, by when it opened: sent once (the
  // view saying it closed can come after the reply, and a second "done" was
  // refused)
  const ended = useRef<number | null>(null);
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
  // the step on screen is kept, picked or not: Escape lets go of the
  // selection (App), and a step picked in the rail gave way to the one
  // pinned before it (a quick rebuild jumped to step 2 mid-edit)
  if (current && pinned !== current.step) setPinned(current.step);

  // a different step starts on its own canvas, with nothing half-done. A
  // play step not yet built opens on its scene, which comes first (spec §1):
  // "I know some" skipped See, and the step opened on Build the order. Its
  // mode is known once its model is in, so that counts as a new key too. A
  // review or a quick rebuild opens on the order: the scene acts it out.
  const key = current
    ? `${current.step}:${current.mode}:${!!(current.reviewing || current.recall)}`
    : "";
  // empty at first, so the step the map opens on starts the same way
  const [shownFor, setShownFor] = useState("");
  if (shownFor !== key) {
    setShownFor(key);
    setCentre(
      current?.mode === "play" &&
        !fromMemory(current) &&
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

  // A review with every rebuild done and every "which idea" card answered
  // closes itself (I'm done today, pressed for you): there is nothing left
  // in it, and its score and next day are said on the closing card.
  const finished =
    !!review &&
    !view.steps.some((s) => s.reviewing) &&
    !review.cards.some((c) => c.picked === null);
  const endReview = () => {
    if (!review || ended.current === review.at) return;
    ended.current = review.at;
    const last = review.cards.filter((c) => c.picked !== null).at(-1);
    const snap: Closed = {
      at: review.at,
      unaided: review.unaided,
      of: review.of,
      last: view.last?.unaided ?? null,
      card: last ? { right: !!last.right, correct: last.correct } : null,
    };
    void act("done").then((r) => {
      if (r.error) ended.current = null;
      else setClosed(snap);
    });
  };
  useEffect(() => {
    if (finished) endReview();
  });
  // a new review puts the closing card away (so does going on: openStep)
  if (closed && review && review.at !== closed.at) setClosed(null);

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
    setClosed(null);
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
  // built as the server counts it (countsBuilt)
  const built = tops.filter((s) =>
    countsBuilt(map.nodes[s.step]?.status, s.rungs),
  ).length;

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
        marks={marks}
        progress={{ got: built, word: "done" }}
        simple
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
            closed={closed}
            onEndReview={endReview}
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
  closed,
  onEndReview,
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
  closed: Closed | null;
  onEndReview: () => void;
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
    (asked === "play" && (st.mode !== "play" || fromMemory(st)))
      ? "step"
      : asked;
  const ready = st.model === "ready";
  const scene = map.scenes[st.step];
  const buildingScene =
    live.working?.nodeId === st.step && live.working.label === BUILDING_SCENE;
  const first = topSteps(view)[0]?.step === st.step;
  const node = map.nodes[st.step];

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

  // The review owns the card while it is open: the step being rebuilt has
  // its check card over the review's line; any other step shows only the
  // review (the step still to rebuild, the "which idea" cards). The step's
  // old Why and What if stay out of it.
  const inReview = !!review && st.reviewing;
  const reviewOnly = !!review && !st.reviewing;
  const closing = !!closed && !review;
  // How much do you know? tops the card on a map with no level yet, and on
  // step 1 while it is drawn (the answer held from the loading screen
  // marked): the first choice never waits for step 1
  const levelCard =
    !review &&
    !closing &&
    st.stage === "see" &&
    !st.worked &&
    (view.level === null || (first && !ready));
  const own = !reviewOnly && !closing && ready;

  // Everything that is not the one next thing, behind the card's ⋯.
  const firstTry =
    mode === "build" &&
    st.checks === 0 &&
    !st.reviewing &&
    !st.recall &&
    !st.onCase;
  const sections: MoreSection[] = [
    {
      head: view.level && !review ? "Starting help" : undefined,
      items:
        view.level && !review
          ? LEVELS.map(([lv, label, says]) => ({
              label,
              title: says,
              on: view.level === lv,
              onClick: () => void act("level", { level: lv }),
            }))
          : [],
    },
    {
      items: [
        ...(ready && firstTry && centre === "step"
          ? [
              {
                label: "Peek at the example",
                title: "It counts as shown",
                onClick: () => void act("showModel", { step: st.step }),
              },
            ]
          : []),
        ...(ready && st.stage === "build" && st.check && st.canHint
          ? [
              {
                label:
                  st.hintOn === "place" ? "Show one place" : "Show one link",
                title:
                  st.hintOn === "place"
                    ? "Puts one part where it goes; it counts as shown"
                    : "Draws one link for you; it counts as shown",
                onClick: () => void act("showLink", { step: st.step }),
              },
            ]
          : []),
        ...(ready &&
        st.stage === "build" &&
        st.check &&
        !st.reviewing &&
        !st.recall
          ? [
              {
                label: "Show the model",
                title:
                  "Shows the whole model as long as you want, then you rebuild it with the parts placed. It counts as shown.",
                onClick: () => void act("showModel", { step: st.step }),
              },
            ]
          : []),
        ...(view.topic && st.stage !== "build"
          ? [
              {
                label:
                  centre === "topic" ? "Back to this step" : "Topic diagram",
                onClick: () => setCentre(centre === "topic" ? "step" : "topic"),
              },
            ]
          : []),
        { label: "Talk about this step", onClick: onThread },
        ...(node?.parent && node.status !== "answered" && !node.dropped
          ? [
              {
                label: "Skip this step",
                onClick: () => void ws.run({ type: "drop", nodeId: st.step }),
              },
            ]
          : []),
      ],
    },
  ];
  // Claude's opening note on the path, to read again (it was "How to start"
  // in the rail)
  const intro = map.chat.find(
    (c) => c.role === "claude" && !c.blankId && !c.nodeId,
  )?.text;

  const reviewAt = review ? review.order.indexOf(st.step) + 1 : 0;
  const passed = st.check?.pass ? st.check : null;

  const side = (ready || review || levelCard || closing) && (
    <aside className="relative flex max-h-[45%] w-full shrink-0 flex-col overflow-y-auto border-t border-line bg-surface px-4 py-3 lg:max-h-none lg:w-[260px] lg:border-t-0 lg:border-l xl:w-[280px] 2xl:w-[300px]">
      {/* ⋯ sits at the top right of the card, beside the one next thing */}
      <div className="absolute top-2.5 right-2.5 z-10">
        <More sections={sections} intro={intro} />
      </div>
      <div className="space-y-4 [&>*:first-child]:pr-8">
        {closing && closed && (
          <ClosingCard
            view={view}
            closed={closed}
            onCarryOn={(() => {
              const c = toCarryOn(view);
              return c ? { step: c.step, go: () => onPick(c.step) } : null;
            })()}
          />
        )}
        {levelCard && <LevelCard here={here} level={view.level} />}
        {reviewOnly && review && (
          <ReviewPanel
            here={here}
            review={review}
            current={st.step}
            onPick={onPick}
            onDone={onEndReview}
          />
        )}
        {/* a quick rebuild that passed says so first */}
        {own && st.stage === "built" && st.recalled && (
          <div className="rounded-lg bg-success-soft px-2.5 py-1.5 text-[13px] font-medium text-success-strong">
            ↻ Quick rebuild ✓ · {CREDIT[st.recalled.credit].word}
            {st.recalled.tries > 1 ? ` · on try ${st.recalled.tries}` : ""}
          </div>
        )}
        {own && !levelCard && st.stage === "see" && (
          <PredictCard key={st.step} here={here} st={st} />
        )}
        {own && st.stage === "build" && <CheckCard here={here} st={st} />}
        {inReview && review && (
          <div className="border-t border-line pt-3">
            <ReviewPanel here={here} review={review} onDone={onEndReview} />
          </div>
        )}
        {/* the pass stays above the Why: it is what you just earned */}
        {own && st.stage === "why" && passed && (
          <div className="text-[13px] font-medium text-success-strong">
            ✓ Right: {passed.keyRight} of {passed.keys} key links.
          </div>
        )}
        {own && st.stage === "why" && (
          <WhyCard key={st.step} here={here} st={st} judging={judging} />
        )}
        {own && st.stage === "built" && (
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
          >
            <WhyCard key={st.step} here={here} st={st} judging={judging} />
          </BuiltCard>
        )}
        {/* what a passing check found (a mix-up's refutation, a "?" to
            argue for): feedback, kept whenever it applies */}
        {own && (st.stage === "why" || st.stage === "built") && st.check && (
          <CheckFindings key={`${st.step}:check`} here={here} st={st} passed />
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
        // the case's own line: the scene is played on it, and a move asked
        // about York's road while only the distances were drawn
        caseLine={[st.caseTitle, st.case].filter(Boolean).join(" — ")}
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
              This step did not draw
            </div>
            <div className="mt-3">
              <SmallBtn
                primary
                disabled={busy}
                title={
                  busy
                    ? WAIT_TITLE
                    : "Claude's model did not hold together, twice: this draws it afresh"
                }
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
              <Drawing since={live.working?.since} />
            </div>
          </div>
        ) : (
          <SmallBtn
            primary
            disabled={busy}
            title={
              busy
                ? WAIT_TITLE
                : "One Claude move: this step's model is written when you open it"
            }
            onClick={() => void act("open", { step: st.step })}
          >
            Draw this step
          </SmallBtn>
        )}
      </div>
    );
  else if (st.stage === "see" && !st.worked)
    // the example waits for the level ("I'm new" shows it): the card on
    // the right asks, and nothing here repeats it
    body = <div className="h-full" />;
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
          line={
            mode === "build"
              ? {
                  say: helpLine(
                    st,
                    review && reviewAt > 0
                      ? { at: reviewAt, of: review.order.length }
                      : undefined,
                  ),
                  how: howTo(st),
                  lowered: st.lowered,
                }
              : undefined
          }
        />
      </ReactFlowProvider>
    );

  // the tray, only while it has a part in it (all placed, it was a column
  // that said so)
  const trayOn =
    ready &&
    mode === "build" &&
    centre === "step" &&
    (st.trayCount > 0 || !!st.typed);

  return (
    <>
      {/* stacked (under 1024 wide), this keeps its own height and the side
          card scrolls in under it: let shrink to fit, the canvas ran past
          its end and the message box sat on the check card's heading */}
      <div className="flex min-w-0 flex-none flex-col lg:min-h-0 lg:flex-1 xl:flex-row">
        {trayOn && <Tray here={here} st={st} />}
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
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-ink">
                  <span className="mr-1.5 text-muted">
                    {stepNumber(view, st.step)}
                  </span>
                  <span data-content>{st.title}</span>
                </div>
              </div>
              {st.mode === "play" && !fromMemory(st) && (
                <Toggle
                  value={centre === "play" ? "play" : "step"}
                  options={[
                    ["play", "▶ Play it"],
                    ["step", "◇ Build the order"],
                  ]}
                  onChange={setCentre}
                />
              )}
            </div>
            {/* the example's name, and what happens in it, while you see
                it; while you build, its name stays in view (a sort step's
                columns weigh evidence for a claim said only on the See you
                skipped). The server leaves it out where it names a part
                you are to recall. */}
            {ready &&
              centre === "step" &&
              (st.worked
                ? st.caseTitle || st.case
                : mode === "build" && !st.onCase && st.caseTitle) && (
                <div className="text-[11.5px] text-muted" data-content>
                  {st.caseTitle && (
                    <span className="font-medium text-body">
                      {st.caseTitle}
                    </span>
                  )}
                  {st.worked && st.caseTitle && st.case && " — "}
                  {st.worked && st.case}
                </div>
              )}
            {ready && st.onCase && st.stage === "build" && (
              <button
                onClick={() => void act("onCase", { step: st.step, on: false })}
                className="text-[11.5px] text-muted hover:text-ink"
                title="The new example is optional: it waits here for you"
              >
                ← Back to my build
              </button>
            )}
          </div>
          <div className="relative min-h-0 flex-1">{body}</div>
          {/* a reply stays until clicked away, on its own step: it sat over
              the next step's canvas */}
          <FloatingComposer
            ws={ws}
            beside={false}
            sticky
            collapsed
            scope={st.step}
            placeholder="Ask anything about the topic, or tell Claude where you are stuck…"
          />
        </div>
      </div>
      {side}
    </>
  );
}

// "Drawing · 12 s": the seconds since Claude started, so a wait is seen to
// move
function Drawing({ since }: { since: number | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
  return (
    <span className="tabular-nums">Drawing{since ? ` · ${secs}s` : "…"}</span>
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
