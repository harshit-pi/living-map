// The one seam between Living Map and the model behind it. The engine only
// knows this interface: to use another model (the Anthropic API, another
// vendor, a local model), add a file next to claude-code.ts that implements it
// and register it in index.ts.

import type { Choice } from "../../shared/model.ts";

// One of your own conversations with the model, outside Living Map. A map
// linked to one is worked with that conversation as context: what you said
// and decided there, and what the model already knows from it.
export type Conversation = {
  id: string;
  cwd: string; // the folder it runs in
  title: string;
  file?: string; // where the provider keeps it, if on disk
  // the ids it had before it was resumed under a new one, oldest first
  previous?: string[];
};

export type ModelRequest = {
  system: string; // the instructions for this kind of canvas
  message: string; // the canvas, the thread, and the action, as text
  model?: string; // an id from `models`, or empty for the provider's default
  effort?: string; // an id from `efforts`, or empty for the provider's default
  // the conversation the map is linked to, read before the message
  conversation?: Conversation;
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

// One answer held to a JSON schema, for the map's own background work (the
// extractor): a fresh call with its own instructions and no tools, never a
// conversation, so it costs the same however long the chat gets.
export type ExtractRequest = {
  system: string; // replaces the provider's own instructions
  message: string;
  schema: Record<string, unknown>; // the JSON Schema the answer must follow
  model?: string; // an id from `models`, or empty for the provider's default
  effort?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export type ExtractResult = {
  ok: boolean;
  value?: unknown; // the answer, already parsed; check it before trusting it
  error?: string;
  ms: number;
  usage: ModelUsage | null;
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
  // Optional: one structured answer (see ExtractRequest). A provider without
  // it can't run the map's extractor.
  extract?(request: ExtractRequest): Promise<ExtractResult>;
  // Optional: find one of your conversations to link a map to, by its id or
  // else the newest one in a folder. A provider without it links nothing.
  findConversation?(hint: { id?: string; cwd?: string }): Conversation | null;
}
