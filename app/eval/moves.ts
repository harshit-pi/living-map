// How long a move takes and how much it writes, and whether what it writes
// still holds: real moves on fixed topics, through the real engine, plugins
// and provider (low effort, the default model), one at a time as you would
// make them, with a pause between them for reading.
//
//   LIVING_MAP_HOME=/some/test/home node eval/moves.ts <label>
//     → eval/moves-<label>.json, and a table on stdout
//
// Per move: output tokens, first words, total time, cost, whether the
// provider had a process ready (warm), and the quality signals the code
// already has (Learn: the model held on the first try, what the scrub had to
// cut; Explore: ops written and how many landed, cells filled).

import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";

import { peek as explorePeek } from "../plugins/explore/core.ts";
import {
  pathSteps,
  peek as learnPeek,
  validate,
} from "../plugins/learn/core.ts";
import { act } from "../server/actions/index.ts";
import { HOME, MODEL_CWD, PROVIDER } from "../server/config.ts";
import { completeOps, unreadableOps } from "../server/core/reply.ts";
import type { StoredMap } from "../server/core/types.ts";
import { createEngine } from "../server/engine.ts";
import type { Hub } from "../server/events.ts";
import { claudeCode, type Spawn } from "../server/providers/claude-code.ts";
import { pickProvider } from "../server/providers/index.ts";
import type {
  ModelProvider,
  ModelReply,
  ModelUsage,
} from "../server/providers/types.ts";
import type { ActionRequest, Settings } from "../shared/model.ts";

const label = process.argv[2] ?? "run";
const THINK_MS = Number(process.env.EVAL_THINK_MS ?? 4000);
const settings: Settings = { model: "", effort: "low" };

type Call = {
  topic: string;
  move: string;
  label: string;
  out: number;
  input: number;
  firstMs: number;
  endMs: number;
  cost: number;
  warm: boolean | null;
  ok: boolean;
  opsWritten: number;
  opsBroken: number;
  chars: number;
  final: string;
  thinkingChars: number;
  thinkingFirstMs: number;
  sectionsSent: boolean;
};
const calls: Call[] = [];
let current = { topic: "", move: "" };

// How much of a reply is thinking, which the provider does not report: read
// off the same stream, per process (Claude Code only).
const thinking = new Map<number, { chars: number; firstMs: number }>();
let lastPid = 0;
const teeSpawn: Spawn = (cmd, args, opts) => {
  const p = nodeSpawn(cmd, args, opts);
  const t = { chars: 0, firstMs: 0, at: 0 };
  thinking.set(p.pid ?? 0, t);
  let buf = "";
  const end = p.stdin!.end.bind(p.stdin!);
  // the clock starts when the message is sent
  p.stdin!.end = ((...a: Parameters<typeof end>) => {
    t.at = Date.now();
    lastPid = p.pid ?? 0;
    return end(...a);
  }) as typeof end;
  p.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.includes("thinking")) continue;
      try {
        const d = JSON.parse(line);
        const th = d.event?.delta?.thinking;
        if (typeof th === "string") {
          if (!t.firstMs) t.firstMs = Date.now() - t.at;
          t.chars += th.length;
        }
      } catch {
        // not a line of JSON
      }
    }
  });
  return p;
};

// the real provider, wrapped to keep one record per call
const real =
  (PROVIDER ?? "claude-code") === "claude-code"
    ? claudeCode({ home: HOME, cwd: MODEL_CWD, spawn: teeSpawn })
    : pickProvider(PROVIDER, { home: HOME, cwd: MODEL_CWD });
let pending = 0;
const provider: ModelProvider = {
  ...real,
  name: real.name,
  models: real.models,
  efforts: real.efforts,
  run(req, onText) {
    const at = { ...current, label: engine.state.working?.label ?? "" };
    const call = real.run(req, onText);
    const pid = lastPid;
    pending++;
    void call.reply.then(async (r: ModelReply) => {
      const u: ModelUsage | null = await r.usage;
      pending--;
      const th = thinking.get(pid);
      calls.push({
        ...at,
        out: u?.output ?? 0,
        input: u?.input ?? 0,
        firstMs: r.firstMs,
        endMs: r.endMs,
        cost: u?.costUsd ?? 0,
        warm: (r as { warm?: boolean }).warm ?? null,
        ok: r.ok,
        opsWritten: completeOps(r.final).length,
        opsBroken: unreadableOps(r.final),
        chars: r.final.length,
        final: r.final,
        thinkingChars: th?.chars ?? 0,
        thinkingFirstMs: th?.firstMs ?? 0,
        sectionsSent: /INSTRUCTIONS FOR THIS MOVE/.test(req.message),
      });
    });
    return call;
  },
  ...(real.warm ? { warm: real.warm.bind(real) } : {}),
  ...(real.release ? { release: real.release.bind(real) } : {}),
};

const hub: Hub = { add() {}, remove() {}, emit() {} };
const engine = createEngine({ provider, hub, initial: null, save: () => {} });

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function idle() {
  for (let quiet = 0; quiet < 3;) {
    await pause(200);
    quiet = engine.state.busy || engine.state.waiting.length ? 0 : quiet + 1;
  }
  // usage arrives a little after the reply
  await pause(1500);
}

// EVAL_ONLY=learn (or explore, or a topic's words) runs part of the set
const ONLY = process.env.EVAL_ONLY ?? "";
const picked = (kind: string, q: string) =>
  !ONLY || ONLY.split(",").some((w) => `${kind} ${q}`.includes(w));

async function move(topic: string, name: string, req: ActionRequest) {
  current = { topic, move: name };
  await pause(THINK_MS);
  const r = await act(engine, { ...req, settings } as ActionRequest);
  await idle();
  if (r.error) console.log(`  ! ${name}: ${r.error}`);
  return engine.state.map!;
}

// ---------------------------------------------------------------- quality

function learnQuality(m: StoredMap, step: string | undefined) {
  const s = learnPeek(m.data);
  const id = step && s?.stepModel[step];
  const model = id ? s!.models[id] : undefined;
  if (!model) return { model: "none" };
  const node = m.nodes[model.step];
  const keys = model.links.filter((l) => l.key);
  return {
    status: model.status,
    retried: calls.some(
      (c) => c.label.includes("second try") && c.topic === m.title,
    ),
    stillValid: validate(model, node).length === 0,
    frame: model.frame.kind,
    parts: model.parts.length,
    links: model.links.length,
    keys: keys.length,
    keysWithHint: keys.filter((l) => l.hint).length,
    predict: !!model.predict,
    whatif: !!model.whatif,
    miscon: model.miscon.length,
    accepts: model.parts.reduce((a, p) => a + p.accept.length, 0),
    reversedNotes: model.links.filter((l) => l.reversed).length,
    title: model.title,
  };
}

function exploreQuality(m: StoredMap) {
  const s = explorePeek(m);
  const root = Object.values(m.nodes).find((n) => !n.parent);
  const b = root ? s.boards[root.id] : undefined;
  return {
    shape: b?.shape ?? null,
    nodes: Object.keys(m.nodes).length,
    options: root
      ? Object.values(m.nodes).filter(
          (n) => n.parent === root.id && n.kind === "option",
        ).length
      : 0,
    wants: b?.rows.length ?? 0,
    cells: b ? Object.keys(b.cells).length : 0,
    stand: !!(root && s.stand[root.id]),
  };
}

// ---------------------------------------------------------------- the topics

const LEARN: [string, string][] = [
  ["concept", "How does the immune system fight a new virus?"],
  ["algorithm", "How does Dijkstra's algorithm find shortest paths?"],
  ["history", "Why did the Roman Republic fall?"],
  ["concept", "How does compound interest grow savings over 30 years?"],
];
const EXPLORE: [string, string][] = [
  ["choice", "Should I rent or buy a flat in Berlin?"],
  ["choice", "Postgres or MongoDB for a new B2B SaaS app?"],
  ["why", "Why did my sourdough loaf not rise?"],
  ["why", "Why are our app's signups down 20% this month?"],
];

const quality: Record<string, unknown>[] = [];
const started = Date.now();

for (const [kind, q] of LEARN) {
  if (!picked(`learn ${kind}`, q)) continue;
  console.log(`learn ${kind}: ${q}`);
  const m = await move(q, `learn start (${kind})`, {
    type: "new",
    text: q,
    purpose: "learn",
  } as ActionRequest);
  const first = pathSteps(m.nodes).find((p) => p.depth === 0)?.id;
  quality.push({
    topic: q,
    move: `learn start (${kind})`,
    ...learnQuality(m, first),
  });
  if (q === LEARN[0][1]) {
    const second = pathSteps(m.nodes).filter((p) => p.depth === 0)[1]?.id;
    if (second) {
      const m2 = await move(q, "learn open step", {
        type: "plugin",
        plugin: "learn",
        name: "open",
        args: { step: second },
      } as ActionRequest);
      quality.push({
        topic: q,
        move: "learn open step",
        ...learnQuality(m2, second),
      });
    }
  }
}

for (const [kind, q] of EXPLORE) {
  if (!picked(`explore ${kind}`, q)) continue;
  console.log(`explore ${kind}: ${q}`);
  const m = await move(q, `explore start (${kind})`, {
    type: "new",
    text: q,
    purpose: "explore",
  } as ActionRequest);
  quality.push({
    topic: q,
    move: `explore start (${kind})`,
    ...exploreQuality(m),
  });
  const root = Object.values(m.nodes).find((n) => !n.parent);
  if (q === EXPLORE[0][1] && root) {
    const m2 = await move(q, "explore fill", {
      type: "plugin",
      plugin: "explore",
      name: "fill",
      args: { q: root.id },
    } as ActionRequest);
    quality.push({ topic: q, move: "explore fill", ...exploreQuality(m2) });
  }
  if (q === EXPLORE[2][1] && root) {
    const opt = Object.values(m.nodes).find((n) => n.parent === root.id);
    if (opt) {
      const before = Object.keys(m.nodes).length;
      const m2 = await move(q, "explore deeper", {
        type: "deeper",
        nodeId: opt.id,
      } as ActionRequest);
      quality.push({
        topic: q,
        move: "explore deeper",
        added: Object.keys(m2.nodes).length - before,
        ...exploreQuality(m2),
      });
    }
  }
}

for (let i = 0; i < 100 && pending; i++) await pause(300);
await engine.stop();
provider.release?.();

const cost = calls.reduce((a, c) => a + c.cost, 0);
fs.writeFileSync(
  new URL(`./moves-${label}.json`, import.meta.url),
  JSON.stringify(
    { label, at: new Date().toISOString(), cost, calls, quality },
    null,
    1,
  ),
);
for (const c of calls)
  console.log(
    `${c.move.padEnd(26)} ${c.label.slice(0, 34).padEnd(34)} out ${String(c.out).padStart(5)} think ${String(c.thinkingChars).padStart(5)}ch text ${String(c.chars).padStart(5)}ch first ${(c.firstMs / 1000).toFixed(1)}s total ${(c.endMs / 1000).toFixed(1)}s warm ${c.warm} ops ${c.opsWritten}${c.opsBroken ? ` broken ${c.opsBroken}` : ""}`,
  );
console.log(
  `${calls.length} calls, $${cost.toFixed(2)}, ${((Date.now() - started) / 60000).toFixed(1)} min`,
);
process.exit(0);
