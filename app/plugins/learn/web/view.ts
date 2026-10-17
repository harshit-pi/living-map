// What Learn's build screen works with: the plugin's view of the map, its
// actions behind one busy guard, and the words its parts share.

import type { Action, ActionResult, MapDoc } from "../../../shared/model.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import {
  HELP,
  PLUGIN_ID,
  type Credit,
  type LearnView,
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
// a key).
export const guardedAct =
  (run: (a: Action) => Promise<ActionResult>, busy: boolean): LearnAct =>
  (name, args = {}) =>
    busy && PAID.has(name)
      ? Promise.resolve<ActionResult>({})
      : run({ type: "plugin", plugin: PLUGIN_ID, name, args });

// said on a button that starts a paid move while Claude works
export const WAIT_TITLE = "Claude is working: this opens once the map settles";

// What the build screen's parts work with.
export type Here = {
  ws: Workspace;
  view: LearnView;
  // a move runs or waits: the buttons that start one are off
  busy: boolean;
  act: LearnAct;
};

// ---------------------------------------------------------------- words

export const helpLine = (st: StepView): string => {
  if (st.recall)
    return `Quick rebuild · L1 · ${HELP[1].name}: only the key links are checked`;
  // a new case is always built at L2 (build.ts), whatever the step's help
  if (st.onCase) return `New case · L2 · ${HELP[2].name}: ${st.caseTitle}`;
  const pre = st.reviewing ? "Review · " : "";
  if (st.help === 0)
    return `${pre}L0 · ${HELP[0].name}: draw the key links that are missing`;
  return `${pre}L${st.help} · ${HELP[st.help].name}: ${HELP[st.help].says.toLowerCase()}`;
};

// a mark is a symbol and a word, never colour alone
export const MARK: Record<Mark, { sym: string; word: string }> = {
  right: { sym: "✓", word: "right" },
  reversed: { sym: "↔", word: "points the wrong way" },
  family: { sym: "~", word: "right pair, a near verb" },
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
