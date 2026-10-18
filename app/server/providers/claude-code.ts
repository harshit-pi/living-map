// The model behind the canvas is your own Claude Code: one stateless `claude -p`
// call per move, streamed as JSON events.
//
// Starting `claude` takes a second or more before the model is even asked, so
// one spare process is kept started for the next move (warm): it reads its
// message as a stream-json line, so it waits for one instead of giving up as
// a plain `-p` does when no stdin comes within 3s. A move whose system prompt,
// model and effort match the spare takes it; any other move starts its own.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type {
  ModelCall,
  ModelProvider,
  ModelReply,
  ModelRequest,
  ModelUsage,
  WarmRequest,
} from "./types.ts";

const TOOLS = "Read,Glob,Grep,WebSearch,WebFetch";

// Living Map's default is low effort: same diagrams in our eval (eval/forms.ts),
// first words in ~5s instead of ~13s.
const DEFAULT_EFFORT = "low";

// a spare nobody used for this long is ended: it holds memory, and the next
// move is as likely to be something else
export const SPARE_IDLE_MS = 5 * 60_000;

export type Spawn = (
  command: string,
  args: string[],
  opts: { cwd: string },
) => ChildProcess;

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

// Every spare of every provider, ended when the server exits. A server killed
// by a signal skips this; its spare then reads the end of its stdin and exits
// by itself, with nothing sent.
const SPARES = new Set<ChildProcess>();
let exitHook = false;
function track(p: ChildProcess) {
  SPARES.add(p);
  p.once("close", () => SPARES.delete(p));
  if (!exitHook) {
    exitHook = true;
    process.once("exit", () => {
      for (const s of SPARES) s.kill("SIGTERM");
    });
  }
}

const alive = (p: ChildProcess) =>
  p.exitCode === null && p.signalCode === null && !p.killed;

export function claudeCode({
  home,
  cwd,
  spawn = nodeSpawn as Spawn,
  idleMs = SPARE_IDLE_MS,
}: {
  home: string;
  cwd: string;
  spawn?: Spawn;
  idleMs?: number;
}): ModelProvider {
  // An empty MCP config keeps the user's MCP servers (and their ~280k tokens of
  // tool definitions) out of every call.
  const emptyMcp = path.join(home, "empty-mcp.json");
  if (!fs.existsSync(emptyMcp)) fs.writeFileSync(emptyMcp, '{"mcpServers":{}}');

  const effortOf = (req: WarmRequest) => req.effort || DEFAULT_EFFORT;
  // everything fixed when the process starts
  const keyOf = (req: WarmRequest) =>
    JSON.stringify([req.system, req.model ?? "", effortOf(req)]);

  function launch(req: WarmRequest): ChildProcess {
    const args = [
      "-p",
      "--input-format",
      "stream-json",
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
      effortOf(req),
    ];
    if (req.model) args.push("--model", req.model);
    const proc = spawn("claude", args, { cwd });
    // a missing `claude` is reported by the move as no result, never thrown
    proc.on("error", () => {});
    proc.stderr?.on("data", () => {});
    return proc;
  }

  // at most one, ever
  let spare: {
    key: string;
    proc: ChildProcess;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  function release() {
    if (!spare) return;
    const { proc, timer } = spare;
    spare = null;
    clearTimeout(timer);
    proc.kill("SIGTERM");
  }

  // the spare for this key, if there is a live one, taken out of reserve
  function take(key: string): ChildProcess | null {
    if (!spare || spare.key !== key || !alive(spare.proc)) {
      release();
      return null;
    }
    const { proc, timer } = spare;
    spare = null;
    clearTimeout(timer);
    SPARES.delete(proc);
    return proc;
  }

  function warm(req: WarmRequest) {
    const key = keyOf(req);
    if (spare && spare.key === key && alive(spare.proc)) {
      clearTimeout(spare.timer);
      spare.timer = setTimeout(release, idleMs);
      spare.timer.unref?.();
      return;
    }
    release();
    const proc = launch(req);
    const timer = setTimeout(release, idleMs);
    timer.unref?.();
    spare = { key, proc, timer };
    track(proc);
    proc.once("close", () => {
      if (spare?.proc === proc) {
        clearTimeout(spare.timer);
        spare = null;
      }
    });
  }

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
    warm,
    release,
    run(req: ModelRequest, onText: (soFar: string) => void): ModelCall {
      const effort = effortOf(req);
      const started = Date.now();
      const spareProc = take(keyOf(req));
      let proc = spareProc ?? launch(req);
      let cancelled = false;
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
      const line = `${JSON.stringify({
        type: "user",
        message: { role: "user", content: req.message },
      })}\n`;

      const reply = new Promise<ModelReply>((resolve) => {
        let done = false;
        let firstMs = 0;
        let text = "";
        const finish = (
          r: Omit<ModelReply, "firstMs" | "endMs" | "usage" | "warm">,
          warm: boolean,
        ) => {
          if (done) return;
          done = true;
          resolve({
            ...r,
            firstMs,
            endMs: Date.now() - started,
            usage,
            warm,
          });
        };

        function attach(p: ChildProcess, warm: boolean) {
          let buf = "";
          let lastText = "";
          let result: CliResult | null = null;
          let stopReason: string | null = null;
          let heard = false;
          p.stdout?.on("data", (chunk: Buffer) => {
            buf += chunk;
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const raw = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              let d;
              try {
                d = JSON.parse(raw);
              } catch {
                continue;
              }
              if (d.type === "stream_event") {
                heard = true;
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
                  finish({ ok: true, final: lastText }, warm);
              }
              if (d.type === "result") {
                heard = true;
                result = d;
                resolveUsage(toUsage(d));
              }
            }
          });
          p.on("close", () => {
            // a spare that ended before it answered anything (it was
            // killed, or the CLI quit while it waited): the move starts its
            // own process instead, as if there had been no spare
            if (warm && !heard && !cancelled && !done) {
              proc = launch(req);
              attach(proc, false);
              return;
            }
            resolveUsage(toUsage(result));
            // ended without a clean finish: trust only the CLI's result
            if (result && !result.is_error)
              finish({ ok: true, final: result.result ?? text }, warm);
            else
              finish(
                {
                  ok: false,
                  final: "",
                  error: result?.subtype ?? "no result",
                },
                warm,
              );
          });
          p.stdin?.on("error", () => {});
          p.stdin?.end(line);
        }

        attach(proc, !!spareProc);
      });

      return {
        reply,
        cancel: () => {
          cancelled = true;
          proc.kill("SIGTERM");
        },
      };
    },
  };
}
