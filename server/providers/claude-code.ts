// The model behind the map is your own Claude Code: the map's background
// calls (filing a chat's new turns) are one stateless `claude -p` each, and
// your chats are found on disk where Claude Code keeps them.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { findConversation } from "./claude-sessions.ts";
import type {
  ExtractRequest,
  ExtractResult,
  ModelProvider,
  ModelUsage,
} from "./types.ts";

// low effort unless a call asks for more: filing a turn is a small, bounded job
const DEFAULT_EFFORT = "low";

export type Spawn = (
  command: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
) => ChildProcess;

type Tokens = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
};

type CliResult = {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: Tokens & { iterations?: Tokens[] };
  modelUsage?: Record<string, { outputTokens?: number; costUSD?: number }>;
};

// What a Claude Code session started by your chat inherits that ties it to
// that chat: started with them, every move ran as part of the chat's session.
const SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_REMOTE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_WORKER_EPOCH",
  "CLAUDE_AFTER_LAST_COMPACT",
  "CLAUDE_EFFORT",
];
export function childEnv(env: NodeJS.ProcessEnv = process.env) {
  const out = { ...env };
  for (const k of SESSION_VARS) delete out[k];
  return out;
}

// $ per million tokens (input, output) and a cache read's share of input. A
// resumed conversation's CLI total also counts everything it cost before, so
// a move on a linked map is priced from its own tokens.
const PRICES: [RegExp, number, number, number][] = [
  [/(fable|mythos)-5-1/, 10, 50, 0.025],
  [/(fable|mythos)-5/, 10, 50, 0.1],
  [/opus-5-5/, 4, 20, 0.05],
  [/opus-(5|4)/, 5, 25, 0.1],
  [/sonnet-5/, 2, 10, 0.1],
  [/sonnet-4/, 3, 15, 0.1],
  [/haiku-5/, 0.1, 0.5, 0.1],
  [/haiku-4/, 1, 5, 0.1],
];
export function priceOf(model: string, usage: CliResult["usage"]): number {
  const price = PRICES.find(([re]) => re.test(model));
  if (!price || !usage) return 0;
  const [, input, output, read] = price;
  const parts = usage.iterations?.length ? usage.iterations : [usage];
  let usd = 0;
  for (const u of parts) {
    const written = u.cache_creation_input_tokens ?? 0;
    const hour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    usd +=
      ((u.input_tokens ?? 0) * input +
        // a write costs 2x input for the hour-long cache, 1.25x for 5 minutes
        hour * input * 2 +
        (written - hour) * input * 1.25 +
        (u.cache_read_input_tokens ?? 0) * input * read +
        (u.output_tokens ?? 0) * output) /
      1e6;
  }
  return usd;
}

export function claudeCode({
  home,
  spawn = nodeSpawn as Spawn,
}: {
  home: string;
  spawn?: Spawn;
}): ModelProvider {
  // An empty MCP config keeps the user's MCP servers (and their ~280k tokens of
  // tool definitions) out of every call.
  const emptyMcp = path.join(home, "empty-mcp.json");
  if (!fs.existsSync(emptyMcp)) fs.writeFileSync(emptyMcp, '{"mcpServers":{}}');

  // A fresh `claude -p` per answer: its own system prompt in place of Claude
  // Code's (so the call isn't mostly Claude Code's instructions and tools), no
  // tools, no settings or MCP servers (your hooks never fire on it), an empty
  // folder, and no prompt cache (the default hour-long cache write costs
  // twice the input, and an extraction is never asked twice). The answer
  // arrives as a structured-output tool call, not text.
  const quiet = path.join(home, "extract");
  function extract(req: ExtractRequest): Promise<ExtractResult> {
    const started = Date.now();
    fs.mkdirSync(quiet, { recursive: true });
    const effort = req.effort || DEFAULT_EFFORT;
    const args = [
      "-p",
      "--output-format",
      "json",
      "--system-prompt",
      req.system,
      "--tools",
      "",
      "--json-schema",
      JSON.stringify(req.schema),
      "--no-session-persistence",
      "--strict-mcp-config",
      "--mcp-config",
      emptyMcp,
      "--setting-sources",
      "",
      "--effort",
      effort,
    ];
    if (req.model) args.push("--model", req.model);
    const env: NodeJS.ProcessEnv = {
      ...childEnv(),
      DISABLE_PROMPT_CACHING: "1",
    };
    if (req.maxOutputTokens)
      env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(req.maxOutputTokens);
    const proc = spawn("claude", args, { cwd: quiet, env });
    return new Promise((resolve) => {
      let out = "";
      let settled = false;
      const end = (r: Omit<ExtractResult, "ms">) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ...r, ms: Date.now() - started });
      };
      // the CLI's own retries can wait minutes on a rate limit: past this,
      // the call is given up and tried again later by its caller
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        end({ ok: false, error: "timed out", usage: null });
      }, req.timeoutMs ?? 120_000);
      timer.unref?.();
      proc.on("error", () =>
        end({ ok: false, error: "could not start claude", usage: null }),
      );
      proc.stderr?.on("data", () => {});
      proc.stdout?.on("data", (chunk: Buffer) => {
        out += chunk;
      });
      proc.on("close", () => {
        let r: CliResult | null;
        try {
          r = JSON.parse(out) as CliResult;
        } catch {
          r = null;
        }
        if (!r) return end({ ok: false, error: "no result", usage: null });
        // the model that did the work: the one the call spent most on, so a
        // small helper call on a cheaper model that wrote more output is not
        // taken for it; by output when the CLI gives no cost
        const model =
          Object.entries(r.modelUsage ?? {}).sort(
            (a, b) =>
              (b[1].costUSD ?? 0) - (a[1].costUSD ?? 0) ||
              (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0),
          )[0]?.[0] ??
          req.model ??
          "";
        const u = r.usage ?? {};
        const usage: ModelUsage = {
          input:
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0),
          output: u.output_tokens ?? 0,
          costUsd: r.total_cost_usd ?? priceOf(model, r.usage),
          model,
          effort,
        };
        if (r.is_error || r.structured_output === undefined)
          return end({
            ok: false,
            error: r.subtype ?? "no structured answer",
            usage,
          });
        end({ ok: true, value: r.structured_output, usage });
      });
      proc.stdin?.on("error", () => {});
      proc.stdin?.end(req.message);
    });
  }

  return {
    name: "Claude Code",
    extract,
    findConversation: (hint) => findConversation(hint),
  };
}
