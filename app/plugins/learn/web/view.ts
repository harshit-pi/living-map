// What Learn's build screen works with: the plugin's view of the map, its
// actions behind one busy guard, and the words its parts share.

import { useRef, useState } from "react";

import type { Action, ActionResult, MapDoc } from "../../../shared/model.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import {
  orderStops,
  placingIsAnswer,
  PLUGIN_ID,
  type Credit,
  type LearnView,
  type Level,
  type Mark,
  type StepView,
} from "../shared.ts";

// A build map's view; null for a classic map, whose server sends no view.
export const learnView = (map: MapDoc): LearnView | null => {
  const v = map.data?.[PLUGIN_ID] as LearnView | undefined;
  return v && v.mode === "build" ? v : null;
};

// Whether a move runs or waits. Every button that starts a paid move waits
// for the map to settle, whatever sent it: a second paid move queued behind
// the first would act on a map about to change (a Why judged against a step
// still being drawn, a model asked for twice). Everything you do on your own
// build (place, link, check, hints) is checked by the server with no model
// call, so it stays open.
export const moving = (live: Workspace["live"]) =>
  live.busy || !!live.working || live.waiting.length > 0;

// the build actions that call the model (open writes a step's model the first
// time; deeper's step is written when it is opened) and the core ones the
// build screen sends that do
export const PAID: ReadonlySet<string> = new Set([
  "open",
  "why",
  "argue",
  "newCase",
  "deeper",
  "scene",
  "explain",
  "next",
]);

export type LearnAct = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<ActionResult>;

// Learn's actions, with the busy guard: a paid one asked while a move runs or
// waits is dropped, whatever sent it (a button drawn before the move started,
// a key). `busy` comes from the server and lags a click by a round trip, so
// the actions sent and not yet answered are held here too: while a paid one
// is out every paid button is off at once (three quick presses of Argue
// were three paid moves), and the same action with the same arguments is
// not sent twice (three checks, or a tray part placed and then refused).
export function useLearnAct(
  run: (a: Action) => Promise<ActionResult>,
  moving: boolean,
): {
  act: LearnAct;
  busy: boolean;
  pending: (name: string, args?: Record<string, unknown>) => boolean;
} {
  const out = useRef(new Set<string>());
  const [sent, setSent] = useState<string[]>([]);
  const paidOut = (keys: Iterable<string>) =>
    [...keys].some((k) => PAID.has(k.slice(0, k.indexOf(":"))));
  const busy = moving || paidOut(sent);
  const act: LearnAct = (name, args = {}) => {
    const key = `${name}:${JSON.stringify(args)}`;
    if (
      out.current.has(key) ||
      (PAID.has(name) && (busy || paidOut(out.current)))
    )
      return Promise.resolve<ActionResult>({});
    out.current.add(key);
    setSent([...out.current]);
    return run({ type: "plugin", plugin: PLUGIN_ID, name, args }).finally(
      () => {
        out.current.delete(key);
        setSent([...out.current]);
      },
    );
  };
  return {
    act,
    busy,
    // with `args`, that very action: "open" on step 1 is not step 2 being
    // drawn (Next step while step 1 was drawn said step 2 was)
    pending: (name, args) =>
      sent.some((k) =>
        args
          ? k === `${name}:${JSON.stringify(args)}`
          : k.startsWith(`${name}:`),
      ),
  };
}

// said on a button that starts a paid move while Claude works
export const WAIT_TITLE = "Claude is working: this opens once the map settles";

// What the build screen's parts work with.
export type Here = {
  ws: Workspace;
  view: LearnView;
  // a move runs or waits, or a paid one you asked for is on its way: the
  // buttons that start one are off
  busy: boolean;
  act: LearnAct;
  // an action you sent that the server has not answered yet (with `args`,
  // that very one)
  pending: (name: string, args?: Record<string, unknown>) => boolean;
};

// ---------------------------------------------------------------- words

// How much help the first builds start with. Each level's cost is its
// tooltip: the pick decides how much help you get, so you can see what it
// takes away before you pick.
export const LEVELS: [Level, string, string][] = [
  ["new", "I'm new", "Shows an example first"],
  ["some", "I know some", "Parts placed; you link them"],
  ["cold", "I know it well", "Just the parts, no help"],
];

// the first step on the path you have not built, to carry on with
export const toCarryOn = (view: LearnView) =>
  topSteps(view).find((s) => s.stage !== "built");

// a frame's word for one of its slots
export const slotWord = (frame: StepView["frame"]): string =>
  frame.kind === "lanes"
    ? "lane"
    : frame.kind === "boxes"
      ? "box"
      : frame.kind === "axis"
        ? "tick"
        : "column";

// What a pass needs, in a line: the tooltip of the check's "Not yet" (a
// card full of ✓ that has not passed says why; with 3 other links, 70% is
// all 3).
export const passRule = (st: StepView): string => {
  const c = st.check;
  const rest =
    c && c.restNeed > 0
      ? `, and ${c.restNeed} of the ${c.rest} other links (you have ${c.restGot})`
      : "";
  const place =
    st.frame.kind === "free"
      ? ""
      : orderStops(st.frame)
        ? ", with every part on a tick, in order"
        : `, with every part in a ${slotWord(st.frame)}`;
  return `A pass needs every key link${rest}${place}.`;
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// A failed check in one line: the first thing a pass still needs.
export const notYet = (st: StepView): string => {
  const c = st.check;
  if (!c) return "Not yet";
  if (c.keyMissing > 0 || c.keyRight < c.keys)
    return `Not yet: ${plural(Math.max(c.keyMissing, c.keys - c.keyRight), "key link")} missing`;
  if (c.outOfOrder > 0)
    return `Not yet: ${plural(c.outOfOrder, "pair")} out of order`;
  if ((c.loose ?? 0) > 0)
    return `Not yet: ${plural(c.loose!, "part")} not in a ${slotWord(st.frame)}`;
  if (c.restGot < c.restNeed)
    return `Not yet: ${plural(c.restNeed - c.restGot, "more link")} needed`;
  return "Not yet";
};

// What to do on the canvas, in plain words: the help level says how much of
// the model you start with ("Draw the 2 missing links", "Link the parts").
// The level's name (L0, "Fill the gaps") and the pass rule are kept off the
// screen: what a pass needs is the check's tooltip.
export const helpLine = (
  st: StepView,
  review?: { at: number; of: number },
): string => {
  // where a part sits is the answer (an axis's order, a sort's columns, a
  // lane or a box): at L1 its parts wait under the frame
  const loose = placingIsAnswer(st.frame) && st.help === 1;
  const put = orderStops(st.frame)
    ? "Put the parts in order"
    : `Put each part in its ${slotWord(st.frame)}`;
  // it counts down as you draw (a learner with 2 of 3 drawn had to work out
  // which one was left): the links still to draw, by count only, never
  // which; all drawn, the check is next. Once checked, the count is the
  // check's (a wrong link drawn is no link less to find)
  const n = st.keys ?? 0;
  const left = st.check
    ? n - st.check.keyRight
    : n - st.links.filter((l) => !l.given).length;
  const say =
    st.help === 0
      ? n > 0
        ? left > 0
          ? `Draw the ${plural(left, "missing link")}`
          : "Check your links"
        : "Draw the missing links"
      : st.help === 1
        ? loose
          ? `${put}, then link them`
          : "Link the parts"
        : `${st.help === 2 ? "Place" : "Name"} the parts, then link them${st.frame.kind === "free" ? "" : `. ${put}`}`;
  if (review)
    return review.of > 1
      ? `Review ${review.at} of ${review.of} · ${say}`
      : `Review · ${say}`;
  if (st.recall) return `Quick rebuild · ${say}`;
  if (st.onCase) return `New example · ${say}`;
  return say;
};

// how a part is placed, said while parts wait outside the frame, then how
// a link is drawn, until you have drawn one: one at a time, so the line
// stays one line over the frame
export const howTo = (st: StepView): string => {
  const own = st.links.filter((l) => !l.given).length;
  const placing = st.trayCount > 0 || st.placed.some((p) => !p.slot);
  if (placing && st.frame.kind !== "free" && own === 0)
    return "drag each one in";
  return own === 0 ? "click a part, then the part it links to" : "";
};

// a mark is a symbol and a word, never colour alone
export const MARK: Record<Mark, { sym: string; word: string }> = {
  right: { sym: "✓", word: "right" },
  reversed: { sym: "↔", word: "points the wrong way" },
  family: { sym: "~", word: "right pair, another verb" },
  miscon: { sym: "✗", word: "a common mix-up" },
  extra: { sym: "?", word: "not in Claude's model" },
};

export const CREDIT: Record<Credit, { sym: string; word: string }> = {
  you: { sym: "●", word: "by you" },
  hints: { sym: "◐", word: "with hints" },
  shown: { sym: "◉", word: "shown" },
};

export const creditCls = (c: Credit | null): string =>
  c === "you"
    ? "text-success"
    : c === "hints"
      ? "text-warning"
      : c === "shown"
        ? "text-hint"
        : "text-line-strong";

const DAY = 86_400_000;

// "in 4 days", "tomorrow", "later today"
export function inDays(at: number, now: number): string {
  const d = Math.ceil((at - now) / DAY);
  if (d <= 0) return "later today";
  if (d === 1) return "tomorrow";
  return `in ${d} days`;
}

// the step on the path a "Go deeper" step sits under, for its number
export const topSteps = (view: LearnView) =>
  view.steps.filter((s) => s.depth === 0);

// a step's number on the path, as the rail shows it ("2", "2.1")
export function stepNumber(view: LearnView, id: string): string {
  const top = topSteps(view);
  const i = top.findIndex((s) => s.step === id);
  if (i >= 0) return String(i + 1);
  const st = view.steps.find((s) => s.step === id);
  const parent = st?.parent ? stepNumber(view, st.parent) : "";
  const sibs = view.steps.filter((s) => s.parent === st?.parent);
  return parent ? `${parent}.${sibs.findIndex((s) => s.step === id) + 1}` : "";
}

// What the canvas shows for a step: the worked case while you see it (or
// after Show the model), your build while you build it, and your build,
// read-only, once it passed.
export const canvasMode = (st: StepView): "worked" | "build" | "done" =>
  st.worked
    ? "worked"
    : st.stage === "build"
      ? "build"
      : st.stage === "see"
        ? "worked"
        : "done";
