// The one seam between Living Map and the model behind it. The engine only
// knows this interface: to use another model (the Anthropic API, another
// vendor, a local model), add a file next to claude-code.ts that implements it
// and register it in index.ts.

import type { Choice } from "../../shared/model.ts";

export type ModelRequest = {
  system: string; // the instructions for this kind of canvas
  message: string; // the canvas, the thread, and the action, as text
  model?: string; // an id from `models`, or empty for the provider's default
  effort?: string; // an id from `efforts`, or empty for the provider's default
};

// what a move is known by before its message is written: a provider may
// start the next call ahead on these (see warm)
export type WarmRequest = Omit<ModelRequest, "message">;

export type ModelUsage = {
  input: number;
  output: number;
  costUsd: number;
  model: string;
  effort: string;
};

export type ModelReply = {
  ok: boolean; // false when the model did not answer (the reason is in `error`)
  final: string; // the reply to apply: the last message, after any tool use
  firstMs: number; // time to the first visible word
  endMs: number; // time until the reply was complete
  error?: string;
  // tokens and cost, which some providers report after the reply itself
  usage: Promise<ModelUsage | null>;
  // the call ran on a process started before it was asked (see warm)
  warm?: boolean;
};

export type ModelCall = {
  reply: Promise<ModelReply>;
  cancel: () => void;
};

export interface ModelProvider {
  readonly name: string;
  readonly models: Choice[]; // the first entry is the default ('' id)
  readonly efforts: Choice[];
  // Streams the reply: `onText` gets everything written so far, every time it grows.
  run(request: ModelRequest, onText: (soFar: string) => void): ModelCall;
  // Optional: get ready for a call that will likely come next with these
  // settings (Claude Code starts its process ahead), so it answers sooner.
  // Costs nothing if it never comes; a call with other settings ignores it.
  warm?(request: WarmRequest): void;
  // let go of whatever warm holds (on Stop)
  release?(): void;
}
