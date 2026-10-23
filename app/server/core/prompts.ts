// What the model is told: the mode's job (each mode is a plugin and brings its
// own), the ops it may write, and how long a reply may be.

import type { Purpose, View } from "../../shared/model.ts";

const OPS = `Changes go in ONE fenced block that starts with \`\`\`map and holds JSON {"ops":[...]}. Write ops one per line.
Map nodes:
  {"op":"add","id":"short-kebab-id","parent":"parent id, or null for the root","kind":"question|option|fact","title":"at most 6 words","summary":"at most 14 words","status":"…"}
  {"op":"update","id":"…", plus any of title, summary, status, detail}
  {"op":"remove","id":"…"}
Kinds: question (title ends with "?"), option (a possible answer or approach), fact (evidence, a constraint, a concept or a hint). Statuses: question → open | answered; option → proposed | chosen | dropped; fact → info.
Never write "detail" when adding a node: details are written only when the user opens one (EXPLAIN).
At most 5 children under any node; prefer fewer, bigger nodes. Mark unverified facts "⚠️ verify".`;

const VIEW: Record<View, string> = {
  visual:
    "VIEW FOR THIS REPLY: VISUAL. Write a caption of at most 2 short sentences (no lists or headings), then the map block. Everything else lives on the canvas.",
  thread:
    "VIEW FOR THIS REPLY: SIDE THREAD on one node. Answer like a short chat reply: at most 120 words of markdown, concrete, no headings. Then the map block only if that node or what is under it should change.",
};

const EXPLAIN =
  "EXPLAIN on a node: write that node's detail with an update op (markdown, at most 180 words, the key point first). Assume the reader may not know the field: define every term in plain words and give one tiny concrete example. Refer to parts of the diagram by their labels, never by ids. The caption is one sentence.";

const THREADS =
  "THREADS: a message may come from a thread pinned to one node. Then stay on that node: answer from its path, and change only that node or nodes under it. Refer to parts of the diagram and blanks by what they say, never by ids.";

// The instructions a move carries beyond the canvas's job: a mode's own
// sections (Learn's topic diagram and playable scene), how to explain a node,
// and how to stay on a side thread. Each move sends only what it needs; the
// rest would be paid for on every call and never used.
// (a plugin adds its own section names)
export type Section =
  "diagram" | "scene" | "explain" | "threads" | (string & {});

// What a move is told, in two parts. The system prompt is the mode's job and
// the map ops, the same on every move of a mode, so the provider can start
// the next call before it is asked (see ModelProvider.warm); the sections
// this move needs go with its message (`move`). A mode's sections go in the
// order the move lists them.
export function promptParts(
  _purpose: Purpose,
  sections: readonly Section[],
  plugin: {
    prompt: string;
    sections?: Record<string, string>;
    ownOps?: boolean;
  },
): { system: string; move: string } {
  const extra: string[] = [];
  for (const s of sections)
    if (plugin.sections?.[s]) extra.push(plugin.sections[s]);
  if (sections.includes("explain")) extra.push(EXPLAIN);
  if (sections.includes("threads")) extra.push(THREADS);
  return {
    system: plugin.ownOps ? plugin.prompt : [plugin.prompt, OPS].join("\n\n"),
    move: extra.join("\n\n"),
  };
}

// everything a move is told, as one text: the two parts together
export function systemPrompt(
  purpose: Purpose,
  sections: readonly Section[],
  plugin: { prompt: string; sections?: Record<string, string> },
): string {
  const { system, move } = promptParts(purpose, sections, plugin);
  return move ? `${system}\n\n${move}` : system;
}

export const viewLine = (view: View): string => VIEW[view] ?? VIEW.visual;

// Added to the system prompt of a map linked to one of the user's own
// conversations, which the model reads before the move's message: the map is
// of that conversation, and the move works only the canvas, never the
// conversation's own unfinished work.
export const LINKED = `THE USER'S CONVERSATION: everything before this message is the user's own conversation with you, outside this canvas. The canvas is a living map of it. Work the canvas from what was said, found and decided there: never ask what it already answers, and when you use something from it, say so briefly ("you said earlier …"). Do not carry on that conversation's own work: do not answer its last message, change files or run commands. Where it asks for this canvas to be opened, that is done: ignore that part. Everything about the canvas and its format is in these instructions, so read no files to learn it. In this reply you only work the canvas.`;

// a move whose words are neither shown nor kept (TurnOptions.quiet): words
// written outside the map block would be paid for and thrown away
export const QUIET_VIEW =
  "VIEW FOR THIS REPLY: the map block only. Write no words before or after it: none of them are shown.";
