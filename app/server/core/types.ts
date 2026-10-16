// What the server keeps that the browser never sees in full: scenes with their
// answers, your progress through them, notes for Claude, the pasted source.

import type {
  AnswerType,
  ChatLine,
  Diagram,
  Fill,
  MapNode,
  MoveFeedback,
  Purpose,
  SceneKind,
  SceneState,
  Thread,
  Usage,
} from "../../shared/model.ts";

// Anything the model wrote: untrusted JSON, checked field by field before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = any;

export type Answer = { type: AnswerType; keys: string[] };
export type Move = {
  ask: string;
  answer: Answer;
  why: string;
  wrong: Record<string, string>;
  choices: string[];
  then: SceneState;
};
export type SceneData = {
  kind: SceneKind;
  title: string;
  start: SceneState;
  moves: Move[];
  complete: boolean;
};
export type Play = {
  at: number;
  wrong: number;
  tries: number;
  shown: number;
  misses: string[];
  last: MoveFeedback | null;
};

export type StoredMap = {
  id: string;
  title: string;
  purpose: Purpose;
  createdAt: number;
  source?: string;
  nodes: Record<string, MapNode>;
  chat: ChatLine[];
  threads: Record<string, Thread>;
  diagram: Diagram | null;
  diagramAt?: number;
  fills: Record<string, Fill>;
  scenes: Record<string, SceneData>;
  play: Record<string, Play>;
  // what you did on the canvas since Claude's last reply, sent with the next move
  notes: string[];
  usage: Usage;
};

// The part of a map that Claude's ops change.
export type Canvas = Pick<StoredMap, "nodes" | "diagram" | "fills"> &
  Partial<Pick<StoredMap, "diagramAt" | "scenes" | "play">>;

export const str = (v: unknown, n: number): string =>
  typeof v === "string" ? v.slice(0, n) : "";
export const list = (v: unknown, n: number): Raw[] =>
  Array.isArray(v) ? v.slice(0, n) : [];
