// Learn on the server: any subject as a path of steps. Its map is core's
// node map, shared with Explore, which is why the two switch into each other.
// A map is in one of two modes (map.data.learn.mode):
// - build (every new map): each step is a small model you see once and build
//   back from memory, checked here with no model call (build.ts, core.ts).
// - classic (a map from before, with no data.learn): a topic diagram with
//   blanks you fill, and steps you play by hand, exactly as before. Its
//   state is the map's top-level fields (diagram, fills, answers, scenes,
//   play): saved maps hold it there, and core applies the diagram and scene
//   ops on every map.
// Blanks, scene moves and builds are checked against the answers the model
// wrote; the answers never reach the browser.

import {
  applyBuildOp,
  BUILD_ACTIONS,
  BUILD_PROMPT,
  BUILD_SECTIONS,
  cleanBuildOp,
  enterBuild,
  isBuildMap,
  rebuilding,
  startBuildMap,
  watched,
} from "./build.ts";
import {
  dueOf,
  lastVisit,
  outlineOf,
  pathSteps,
  peek,
  stepOf,
  viewOf,
} from "./core.ts";
import { countsBuilt } from "./shared.ts";
import * as canvas from "../../server/actions/canvas.ts";
import type { Ctx } from "../../server/actions/context.ts";
import { hint as coreHint } from "../../server/actions/steps.ts";
import { now as clock } from "../../server/clock.ts";
import {
  accepts,
  diagramOutline,
  elementsOf,
  revealBlank,
} from "../../server/core/diagram.ts";
import { newPlay, playMove, showMove } from "../../server/core/scene.ts";
import {
  own,
  safeId,
  type Play,
  type Raw,
  type StoredMap,
} from "../../server/core/types.ts";
import type { ServerPlugin } from "../../server/plugin.ts";
import type { ActionResult, MapNode } from "../../shared/model.ts";

// the model's job on a learning path, sent on every move
const PROMPT = `You are the engine behind a visual LEARNING CANVAS for any subject: code, protocols, maths, finance, science, history. The learner builds the understanding; you never hand over the full answer unless they press SHOW ANSWER.
- The map is the learner's PATH: the root question is the topic; its children are 3-5 STEPS (questions, open until the learner gets them right), in the order to learn them.
- The TOPIC DIAGRAM shows the subject itself in the form that fits it, with the parts the learner must discover as BLANKS (at most 3 at a time).
- HINT on a step climbs a ladder, one rung per press: 1 = add a fact under the step titled "Hint 1" with a pointed question; 2 = add or reshape a BLANK on the diagram for that step (and a fact "Hint 2" saying where to look); 3 = a fact "Hint 3" with a fully worked tiny example. Never skip rungs.
- When the learner answers a step (USER SAYS on a step), judge it: if right, set the step answered and say what they got right; if not, say which part is off, without the fix.
- SHOW ANSWER on a step: write the full answer in that step's detail (key idea first) and fill the step's blanks on the diagram.
- Prefer tiny concrete examples written as plain text.
- Talk to the learner as "you", never "the learner".
- For a coding problem, the LAST step is titled "Write it" (summary: what the code must do). When the learner sends code there, trace it on the example: say which line first goes wrong and why, or that it works and its cost. Never rewrite their code unless SHOW ANSWER.`;

// sent on the moves that draw, fill or judge the topic diagram
const DIAGRAM = `TOPIC DIAGRAM (learning maps only). Replace it whole with {"op":"diagram","spec":{...}}. Pick the FORM that fits the topic's shape:
- "sequence": who does what in order (protocols, algorithms step by step, processes between parties).
  {"form":"sequence","title":"…","lanes":["Client","Server"],"steps":[{"id":"s1","from":"Client","to":"Server","label":"SYN"}]}
- "concept": ideas and how they relate (theories, models, formulas' inputs).
  {"form":"concept","title":"…","nodes":[{"id":"vol","label":"Volatility","note":"≤8 words"}],"links":[{"from":"vol","to":"price","label":"raises"}]}
- "timeline": events in time (history, versions, a project).
  {"form":"timeline","title":"…","events":[{"id":"e1","when":"Jun 1914","label":"Archduke shot","note":"≤10 words"}]}
- "structure": parts inside or pointing to parts (systems, data structures, anatomy, architectures).
  {"form":"structure","title":"…","boxes":[{"id":"map","label":"Hash map","rows":["key → node"]}],"arrows":[{"from":"map","to":"n1","label":"points to"}]}
- "grid": alternatives against criteria.
  {"form":"grid","title":"…","columns":["SQL","NoSQL"],"rows":[{"label":"Schema","cells":[{"id":"c1","text":"Fixed"},{"id":"c2","text":"Flexible"}]}]}
DRAW IT ON A TINY CONCRETE EXAMPLE: real values, real names, real dates, real messages (e.g. the actual input words and the groups they land in; the actual packets with their numbers). A blank is then something the learner can work out by hand: a value, a key, a pointer, a message, a cause. Never a generic pipeline of abstract stages ("Input feeds Step feeds Output").
For coding problems, prefer the data the algorithm builds (a grid of input → computed key → where it goes, or the structure's actual state) over a flowchart of the code.
TEACH BEFORE YOU TEST: a blank must be something the learner can work out from what the diagram already shows plus everyday sense, never something that needs a term or fact they have not been shown. If the question reads as new to the subject ("explain X", "what is X", "how does X work"), draw the whole picture with every label filled and at most ONE blank, the most inferable one; labels name what each part does in plain words ("Vector DB: finds the stored text closest in meaning"), not bare jargon.
BLANKS: any step, node, event, box or cell may be a blank the learner fills: give it an "id", set "blank":true and a "prompt" (≤10 words), and leave its label/text EMPTY. Also give "accept": 1-5 short forms of the right answer as the learner might type them, the canonical one first (e.g. ["4"], ["(2,0)", "2,0", "row 2 col 0"], ["aet"]), and "why": ≤20 words saying why it is right, shown when they get it. The server checks typed answers against "accept" itself and never shows "accept" or "why" to the learner; put the answer nowhere else in the spec, and do not draw it in place either: if a blank asks where something goes or what it links to, that thing must not already sit there or be linked there elsewhere in the diagram (a blank asking which slot "cow" lands in means no box or arrow shows "cow" in a slot).
At most 12 elements in a diagram; short labels. Arrows mean ONE thing per diagram, and every arrow has a label.
Edit in place: when you send the diagram again, keep every element, id and "accept" list that stays, keep filled parts filled, and change only what the move needs.
When the learner fills a blank (FILL), the server has already accepted any exact match, so you see only answers it could not place: they may still be right in other words. Judge it with {"op":"judge","id":"blank id","state":"right"|"wrong","label":"the correct text, ONLY when right"}. If wrong, say what is off in the caption without giving the answer.
In anything the learner reads, refer to a blank by what it asks, never by its id.`;

// sent only on the move that builds a playable scene
const SCENE = `PLAYABLE SCENE (only when the ACTION asks for one): the learner DOES one step by hand, move by move, on a tiny concrete example. In the map block write the scene header FIRST, {"op":"scene","step":"<step id>","spec":{"kind":…,"title":…,"start":<state>}}, then ONE op per move, {"op":"move","step":"<step id>",<move fields>}, so the learner can start playing while you write. Nothing else in the block.
Pick the kind that fits; every scene is data for one of three shapes:
- "board": a grid of cells (chess boards, grids, matrices, DP tables, Punnett squares, truth tables). State: {"cells":[["","Q"],["",""]],"marks":[{"at":[1,0],"tone":"attack"}],"note":"≤12 words"}
- "array": a row of items with named pointers (two pointers, binary search, sorting, stacks, queues, sliding windows). State: {"items":["2","7","11"],"pointers":[{"name":"lo","at":0}],"marks":[{"at":2,"tone":"focus"}],"note":"…"}
- "tree": nodes with parents (recursion, backtracking, BSTs, heaps, decision trees). State: {"nodes":[{"id":"r","label":"[]","parent":null}],"marks":[{"at":"r","tone":"focus"}],"note":"…"}
Tones: focus, attack, good, bad, path, dim.
Move fields: "ask" (≤14 words: what to do now, not how), "answer", "then" (the full state after the right move; omit it if nothing on the picture changes), "why" (≤20 words, shown after a right move), "wrong" ({"<key>":"≤15 words"} for likely wrong picks), "choices" (optional buttons). Keep notes short.
Marks: every state shows the consequences so far (on a board, every attacked, visited or blocked cell; in an array, the live window or range), so the picture explains itself. A mark must NEVER point at the answer of the move that comes next: no focus on the square to click. Focus only what just changed.
Answers (exact; the browser checks them without you): {"cell":[r,c]} or {"cells":[[r,c],…]} (any of), {"index":i}, {"node":"id"}, {"choice":"one of the choices"}, {"text":["accepted","answers"]}. Wrong keys: "r,c", "i", node id, or the choice/text.
5-10 moves. The moves make the learner carry out the process (place, pick, compare, move a pointer, backtrack, expand), not recall facts. Include at least one move where the obvious pick is wrong, with its "wrong" note. Use "choices" for decisions such as ["Place here","Backtrack"] alongside board clicks. Marks show consequences (attacked squares, visited cells, the window), so the picture explains itself after each move.`;

// the first move on a new Learn map
export function startAction(title: string): string {
  return `start. The learner wants to understand: "${title}". Create the root question (the topic, parent null) and 3-5 steps under it in learning order. Then build the TOPIC DIAGRAM in the form that fits this topic best: the skeleton of the subject, with the 2-3 parts the learner should discover first as blanks. No solution. In the map block write the diagram op FIRST, then the root and the steps, so the picture appears before the path.`;
}

// Ids the browser sends become object keys. A core action's ids are checked
// before it gets here; one sent as a plugin action is checked here.
const id = (v: unknown): string =>
  typeof v === "string" && safeId(v) ? v : "";

function fill(
  ctx: Ctx,
  blankId: string,
  text: string,
): Promise<ActionResult> | ActionResult {
  // only a blank still on the diagram is asked about: no paid turn for one
  // that is not there
  if (
    !blankId ||
    !ctx.map.diagram ||
    !elementsOf(ctx.map.diagram).some((el) => el.id === blankId && el.blank)
  )
    return { error: "No such blank." };
  const typed = String(text ?? "").slice(0, 200);
  ctx.map.chat.push({
    role: "you",
    text: `Filled a blank: ${typed}`,
    ts: Date.now(),
  });
  // a right answer the model already wrote down is checked here, instantly,
  // with no model call; anything else goes to the model for a verdict
  const answer = own(ctx.map.answers, blankId);
  if (accepts(answer, typed) && answer) {
    const shown = answer.accept[0];
    ctx.map.fills[blankId] = { text: shown, state: "right" };
    revealBlank(ctx.map.diagram, blankId, shown);
    ctx.map.chat.push({
      role: "claude",
      text: answer.why ? `Right: ${answer.why}` : "Right.",
      ts: Date.now(),
      blankId,
    });
    ctx.note(
      `Filled blank ${blankId} with "${typed}": right (checked against its accepted answers).`,
    );
    ctx.engine.push();
    return { ok: true };
  }
  ctx.map.fills[blankId] = { text: typed, state: "pending" };
  ctx.engine.push();
  return ctx.engine.turn(
    `FILL: the learner wrote "${text}" in blank ${blankId} on the topic diagram. Judge it with a judge op.`,
    ctx.settings,
    {
      label: "Checking your answer",
      sections: ["diagram"],
      blankId,
    },
  );
}

function buildScene(
  ctx: Ctx,
  nodeId: string,
): Promise<ActionResult> | ActionResult {
  const found = ctx.node(nodeId);
  if (!found) return { error: "No such step." };
  if (rebuilding(ctx.map, nodeId)) return { error: REBUILDING };
  // on a build map the scene is played on the step's own case, which its
  // model, its Why and its feedback are about (it was played on another);
  // and a move is answered from what is on screen: "Click the town York's
  // road reaches" was asked over a row of distances with no road in it, and
  // the road was said only after the pick
  return ctx.engine.turn(
    `SCENE for step ${found.named}: build a playable scene for this step (op "scene", step "${nodeId}"), ${isBuildMap(ctx.map) ? "on the step's own case (the CURRENT STEP's case and parts above): the same list, numbers and target, move for move as its parts say. Every move can be worked out from the picture and its note as they stand when it is asked: a road, an edge or a number a move asks about is in an item, a pointer or the note before that move, never only in its why" : "on the same tiny example as the diagram where it fits"}.`,
    ctx.settings,
    { label: "Building a playable scene", nodeId, sections: ["scene"] },
  );
}

// A finished scene counts as worked out by you unless most of it was shown.
// On a build map a step is built by its build and Why (build.ts): a scene
// played to the end set it answered, and the path read "2 of 4 built" with
// the subgoal order not built.
function finishScene(ctx: Ctx, node: MapNode, p: Play) {
  const total = ctx.map.scenes[node.id].moves.length;
  if (node.kind === "question" && !node.revealed && !isBuildMap(ctx.map)) {
    if (p.shown * 2 > total) node.revealed = true;
    else node.status = "answered";
  }
  ctx.note(
    `Played the scene on "${node.title}": ${total} moves, ${p.wrong} wrong tries, ${p.shown} shown.`,
  );
}

const REBUILDING =
  "Rebuild the order first: the scene comes back once it is checked.";

function advance(
  ctx: Ctx,
  nodeId: string,
  step: (before: Play) => Play,
): ActionResult {
  const scene = ctx.map.scenes[nodeId];
  const node = ctx.map.nodes[nodeId];
  if (!scene || !node) return { error: "No scene on that step." };
  if (rebuilding(ctx.map, nodeId)) return { error: REBUILDING };
  const before = ctx.map.play[nodeId] ?? newPlay();
  const p = step(before);
  ctx.map.play[nodeId] = p;
  if (p.at >= scene.moves.length && before.at < scene.moves.length)
    finishScene(ctx, node, p);
  ctx.engine.push();
  return { ok: p.last?.ok ?? false };
}

// Checked here, instantly, against the answers the model wrote: no model call.
const play = (ctx: Ctx, nodeId: string, key: string) =>
  advance(ctx, nodeId, (before) =>
    playMove(ctx.map.scenes[nodeId], before, String(key ?? "")),
  );

const show = (ctx: Ctx, nodeId: string) =>
  advance(ctx, nodeId, (before) => showMove(ctx.map.scenes[nodeId], before));

function replay(ctx: Ctx, nodeId: string): ActionResult {
  if (!ctx.map.scenes[nodeId]) return { error: "No scene on that step." };
  if (rebuilding(ctx.map, nodeId)) return { error: REBUILDING };
  ctx.map.play[nodeId] = newPlay();
  ctx.engine.push();
  return {};
}

// a build map has no topic diagram section: a core move that names it (a
// message, Next) sends it only to classic maps
const CLASSIC: Record<string, string> = { diagram: DIAGRAM, scene: SCENE };
const BUILD: Record<string, string> = { ...BUILD_SECTIONS, scene: SCENE };

// the moves that work on a step's hidden model, and so may read it whole
const ON_MODEL = new Set(["model", "why", "case", "argue", "layer"]);

const classicOutline = (map: StoredMap) =>
  `TOPIC DIAGRAM:\n${diagramOutline(map.diagram, map.fills, map.answers)}`;

// the root's steps, as the path counts them
const stepsOf = (map: StoredMap) => {
  const nodes = Object.values(map.nodes);
  const root = nodes.find((n) => !n.parent);
  return nodes.filter(
    (n) => n.kind === "question" && n.parent && n.parent === root?.id,
  );
};

// a core action the classic screen sends, which a build map answers its own way
const either =
  (classic: (ctx: Ctx, a: Raw) => Promise<ActionResult> | ActionResult) =>
  (build: (ctx: Ctx, a: Raw) => Promise<ActionResult> | ActionResult) =>
  (ctx: Ctx, a: Raw) => (isBuildMap(ctx.map) ? build(ctx, a) : classic(ctx, a));

export const learn: ServerPlugin = {
  id: "learn",
  label: "Learn",
  canvasName: "learning path",
  switchesWith: ["explore"],
  // a classic map's prompt, word for word as before (pinned by a fixture)
  prompt: PROMPT,
  sections: { diagram: DIAGRAM, scene: SCENE },
  promptFor: (map) =>
    isBuildMap(map)
      ? { prompt: BUILD_PROMPT, sections: BUILD }
      : { prompt: PROMPT, sections: CLASSIC },
  outline: (map, move) => {
    const s = peek(map.data);
    if (s?.mode !== "build") return classicOutline(map);
    const full = !!move?.sections.some((x) => ON_MODEL.has(x));
    // the step the move is about (a scene asked on step 2 was written on
    // step 1's case, the step last worked on), else the one worked on
    const text = outlineOf(s, map.nodes, {
      full,
      at: stepOf(map.nodes, move?.nodeId),
      others: !!move?.sections.includes("model"),
    });
    // a map practised as builds after the topic diagram keeps it in view
    return map.diagram ? `${text}\n\n${classicOutline(map)}` : text;
  },
  applyOp: (map, op, { scope }) => applyBuildOp(map, op, scope),
  cleanOp: (map, op) => cleanBuildOp(map, op),

  start(ctx) {
    return startBuildMap(ctx);
  },

  // a map switched to Learn that was never in it gets its path and step 1's
  // model; one that was keeps what it has, with no call
  enter: (ctx) => enterBuild(ctx),

  // every core action: the path, the diagram and the step panel use them all
  core: [
    "choose",
    "drop",
    "restore",
    "focus",
    "fork",
    "thread",
    "explain",
    "deeper",
    "challenge",
    "next",
    "message",
    "fill",
    "hint",
    "answer",
    "scene",
    "play",
    "playshow",
    "replay",
  ],

  // blanks and scenes are Learn's own; thread, deeper and next are core's,
  // worded for a learner working through steps; the build actions are
  // build.ts's (hint and deeper answer both screens)
  actions: {
    ...BUILD_ACTIONS,
    fill: (ctx, a: Raw) => fill(ctx, id(a.blankId), a.text),
    scene: (ctx, a: Raw) => buildScene(ctx, id(a.nodeId)),
    play: (ctx, a: Raw) => play(ctx, id(a.nodeId), a.key),
    playshow: (ctx, a: Raw) => show(ctx, id(a.nodeId)),
    replay: (ctx, a: Raw) => replay(ctx, id(a.nodeId)),
    // what Claude says while you build is watched (build.ts): a key link it
    // names counts as hinted
    thread: (ctx, a: Raw) =>
      watched(ctx, id(a.nodeId), () =>
        canvas.thread(
          ctx,
          id(a.nodeId),
          id(a.threadId) || undefined,
          a.text,
          ({ node, named }) =>
            node.kind !== "question"
              ? null
              : isBuildMap(ctx.map)
                ? `the learner wrote in the thread on step ${named}. Answer their question about this step without naming the links of its model: they build it back from memory, and the server checks it.`
                : `the learner wrote in the thread on step ${named}. If it is an answer to the step, judge it; otherwise answer their question about this step.`,
        ),
      ),
    explain: (ctx, a: Raw) =>
      watched(ctx, id(a.nodeId), () => canvas.explain(ctx, id(a.nodeId))),
    message: (ctx, a: Raw) =>
      watched(ctx, null, () =>
        canvas.message(
          ctx,
          a.text,
          Array.isArray(a.selection) ? a.selection : [],
        ),
      ),
    hint: either((ctx, a) => coreHint(ctx, id(a.nodeId)))(BUILD_ACTIONS.hint),
    // a build map goes deeper on a part of a step's model; without a part
    // (or on a classic map) it breaks the step down as before
    deeper: either((ctx, a) =>
      canvas.deeper(ctx, id(a.nodeId), "Breaking it into smaller steps"),
    )((ctx, a) =>
      a?.part
        ? BUILD_ACTIONS.deeper(ctx, a)
        : canvas.deeper(ctx, id(a.nodeId ?? a.step), "Going deeper"),
    ),
    next: (ctx) =>
      watched(ctx, null, () =>
        canvas.next(
          ctx,
          isBuildMap(ctx.map)
            ? "next: point the learner at the next step to build, without giving away its model."
            : "next: point the learner at the next open step and make its first move clear, without solving it.",
        ),
      ),
  },

  // what the browser sees of a build map; a classic map has no view, so it
  // goes out exactly as it did before build mode
  view: (map) => {
    const s = peek(map.data);
    return s?.mode === "build"
      ? viewOf(s, map.nodes, clock(), !!map.diagram)
      : undefined;
  },

  due: (map, now) => {
    const s = peek(map.data);
    if (s?.mode !== "build") return { now: 0, next: null };
    return dueOf(s, new Set(pathSteps(map.nodes).map((p) => p.id)), now);
  },

  // the path's steps: worked out by you (classic), or built (build), and due
  summary(map) {
    const steps = stepsOf(map);
    if (isBuildMap(map)) {
      const s = peek(map.data);
      const built = steps.filter((n) =>
        countsBuilt(n.status, s?.steps[n.id]?.rungs),
      ).length;
      const due = learn.due!(map, clock()).now;
      // the headline of the last review: today, unaided
      const last = s ? lastVisit(s) : null;
      return `${built} of ${steps.length} built${due ? ` · ${due} ${due === 1 ? "step" : "steps"} due` : ""}${last ? ` · last review ${last.unaided} of ${last.of} unaided` : ""}`;
    }
    const done = steps.filter(
      (n) => n.status === "answered" && !n.revealed,
    ).length;
    return `${done} of ${steps.length} worked out by you${map.diagram?.form ? ` · ${map.diagram.form}` : ""}`;
  },
};
