// The one seam between Living Map and the model behind it: to use another
// model (the Anthropic API, another vendor, a local model), add a file next
// to claude-code.ts that implements it and register it in index.ts.

// One of your own conversations with the model: the chat a map follows.
export type Conversation = {
  id: string;
  cwd: string; // the folder it runs in
  title: string;
  file?: string; // where the provider keeps it, if on disk
  // the ids it had before it was resumed under a new one, oldest first
  previous?: string[];
};

export type ModelUsage = {
  input: number;
  output: number;
  costUsd: number;
  model: string;
  effort: string;
};

// One answer held to a JSON schema, for the map's own background work (the
// extractor): a fresh call with its own instructions and no tools, never a
// conversation, so it costs the same however long the chat gets.
export type ExtractRequest = {
  system: string; // replaces the provider's own instructions
  message: string;
  schema: Record<string, unknown>; // the JSON Schema the answer must follow
  model?: string; // a model name, or empty for the provider's default
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
  // Optional: one structured answer (see ExtractRequest). A provider without
  // it can't run the map's extractor.
  extract?(request: ExtractRequest): Promise<ExtractResult>;
  // Optional: find one of your conversations to link a map to, by its id or
  // else the newest one in a folder. A provider without it links nothing.
  findConversation?(hint: { id?: string; cwd?: string }): Conversation | null;
}
