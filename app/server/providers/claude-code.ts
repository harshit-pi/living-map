// The model behind the canvas is your own Claude Code: one stateless `claude -p`
// call per move, streamed as JSON events.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type {
  ModelCall,
  ModelProvider,
  ModelReply,
  ModelRequest,
  ModelUsage,
} from "./types.ts";

const TOOLS = "Read,Glob,Grep,WebSearch,WebFetch";

// Living Map's default is low effort: same diagrams in our eval (eval/forms.ts),
// first words in ~5s instead of ~13s.
const DEFAULT_EFFORT = "low";

type CliResult = {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage?: Record<string, { outputTokens?: number }>;
};

export function claudeCode({
  home,
  cwd,
}: {
  home: string;
  cwd: string;
}): ModelProvider {
  // An empty MCP config keeps the user's MCP servers (and their ~280k tokens of
  // tool definitions) out of every call.
  const emptyMcp = path.join(home, "empty-mcp.json");
  if (!fs.existsSync(emptyMcp)) fs.writeFileSync(emptyMcp, '{"mcpServers":{}}');

  return {
    name: "Claude Code",
    models: [
      { id: "", label: "Default model" },
      { id: "fable", label: "Fable 5.1" },
      { id: "opus", label: "Opus 5.5" },
      { id: "sonnet", label: "Sonnet 5.5" },
      { id: "haiku", label: "Haiku 5.5" },
    ],
    efforts: [
      { id: "", label: "Effort: auto (low)" },
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra high" },
      { id: "max", label: "Max" },
    ],
    run(req: ModelRequest, onText: (soFar: string) => void): ModelCall {
      const effort = req.effort || DEFAULT_EFFORT;
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--append-system-prompt",
        req.system,
        "--tools",
        TOOLS,
        "--allowedTools",
        TOOLS,
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

      const started = Date.now();
      const proc = spawn("claude", args, { cwd });
      let resolveUsage: (u: ModelUsage | null) => void = () => {};
      const usage = new Promise<ModelUsage | null>((r) => {
        resolveUsage = r;
      });
      const toUsage = (r: CliResult | null): ModelUsage | null => {
        if (!r) return null;
        const u = r.usage ?? {};
        const model =
          Object.entries(r.modelUsage ?? {}).sort(
            (a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0),
          )[0]?.[0] ??
          req.model ??
          "";
        return {
          input:
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0),
          output: u.output_tokens ?? 0,
          costUsd: r.total_cost_usd ?? 0,
          model,
          effort,
        };
      };

      const reply = new Promise<ModelReply>((resolve) => {
        let buf = "";
        let text = "";
        let lastText = "";
        let result: CliResult | null = null;
        let firstMs = 0;
        let stopReason: string | null = null;
        let done = false;
        const finish = (r: Omit<ModelReply, "firstMs" | "endMs" | "usage">) => {
          if (done) return;
          done = true;
          resolve({ ...r, firstMs, endMs: Date.now() - started, usage });
        };
        proc.stdout.on("data", (chunk: Buffer) => {
          buf += chunk;
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            let d;
            try {
              d = JSON.parse(line);
            } catch {
              continue;
            }
            if (d.type === "stream_event") {
              const e = d.event;
              if (e?.type === "message_start") {
                lastText = "";
                stopReason = null;
              }
              if (e?.type === "message_delta" && e.delta?.stop_reason)
                stopReason = e.delta.stop_reason;
              if (e?.type === "content_block_delta" && e.delta?.text) {
                if (!firstMs) firstMs = Date.now() - started;
                text += e.delta.text;
                lastText += e.delta.text;
                onText(text);
              }
              // The reply is complete when the model stops without a pending tool
              // call. The CLI's own "result" event and exit come seconds later, so
              // waiting for them would make every move feel slow.
              if (
                e?.type === "message_stop" &&
                stopReason &&
                stopReason !== "tool_use"
              )
                finish({ ok: true, final: lastText });
            }
            if (d.type === "result") {
              result = d;
              resolveUsage(toUsage(d));
            }
          }
        });
        proc.stderr.on("data", () => {});
        proc.on("close", () => {
          resolveUsage(toUsage(result));
          // ended without a clean finish: trust only the CLI's result
          if (result && !result.is_error)
            finish({ ok: true, final: result.result ?? text });
          else
            finish({
              ok: false,
              final: "",
              error: result?.subtype ?? "no result",
            });
        });
        proc.stdin.end(req.message);
      });

      return { reply, cancel: () => proc.kill("SIGTERM") };
    },
  };
}
