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

// a mode's sections go in the order the move lists them
export function systemPrompt(
  _purpose: Purpose,
  sections: readonly Section[],
  plugin: { prompt: string; sections?: Record<string, string> },
): string {
  const parts = [plugin.prompt, OPS];
  for (const s of sections)
    if (plugin.sections?.[s]) parts.push(plugin.sections[s]);
  if (sections.includes("explain")) parts.push(EXPLAIN);
  if (sections.includes("threads")) parts.push(THREADS);
  return parts.join("\n\n");
}

export const viewLine = (view: View): string => VIEW[view] ?? VIEW.visual;
