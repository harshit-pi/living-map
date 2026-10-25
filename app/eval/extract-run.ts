// The extractor over your own chats, offline: each chat is filed batch by
// batch as it would be live, and the map is saved at 5 checkpoints for the
// labeler (eval/extract-label.ts) and the scorer (eval/extract-score.ts).
// It calls the model (Claude Code's default model unless --model names one):
// only when asked. Everything it writes stays in ~/.living-map/eval/extract.
//
//   node eval/extract-run.ts --pick 15 [--max-usd 40]
//   node eval/extract-run.ts <transcript.jsonl> [--turns 30] [--fresh]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  apply,
  batches,
  message,
  SCHEMA,
  SYSTEM,
  type Answer,
} from "../ledger/extract.ts";
import { emptyStore, listsOf, type Store } from "../ledger/items.ts";
import { toMapItems } from "../ledger/items.ts";
import { toMermaid } from "../ledger/mermaid.ts";
import {
  emptyTranscript,
  readMore,
  view,
  type Turn,
} from "../ledger/transcript.ts";
import { claudeCode } from "../server/providers/claude-code.ts";

const home = path.join(os.homedir(), ".living-map");
const OUT = path.join(home, "eval", "extract");
const provider = claudeCode({ home, cwd: home });

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = flag("--model") ?? "";
const maxUsd = Number(flag("--max-usd") ?? 40);
const turnCap = Number(flag("--turns") ?? 0);
const pick = Number(flag("--pick") ?? 0);
// files a chat again even when an earlier run finished it
const fresh = args.includes("--fresh");
const paths = args.filter(
  (a, i) => a.endsWith(".jsonl") && !args[i - 1]?.startsWith("--"),
);

async function turnsOf(file: string): Promise<Turn[]> {
  const t = emptyTranscript();
  await readMore(t, file);
  // offline every turn is finished: nothing is still being written
  return view(t, Number.POSITIVE_INFINITY).turns;
}

// Recent chats with enough turns to have a shape, at most 3 per project so
// one project doesn't stand for all of them; very long ones are left out to
// keep a run's cost in bounds.
async function choose(n: number): Promise<string[]> {
  const root = path.join(os.homedir(), ".claude", "projects");
  const files = fs
    .readdirSync(root)
    .flatMap((d) => {
      const dir = path.join(root, d);
      try {
        return fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => path.join(dir, f));
      } catch {
        return [];
      }
    })
    .map((f) => ({ f, st: fs.statSync(f) }))
    .filter((x) => x.st.size > 300_000)
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const out: string[] = [];
  const perProject = new Map<string, number>();
  for (const { f } of files) {
    if (out.length >= n) break;
    const project = path.basename(path.dirname(f));
    if ((perProject.get(project) ?? 0) >= 3) continue;
    const turns = await turnsOf(f);
    if (turns.length < 30 || turns.length > 250) continue;
    out.push(f);
    perProject.set(project, (perProject.get(project) ?? 0) + 1);
  }
  return out;
}

// The disk can be full for a moment (other work on the machine); a write
// waits and tries again rather than losing the chat's progress.
async function save(file: string, text: string) {
  for (let tries = 0; ; tries++) {
    try {
      fs.writeFileSync(file, text);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOSPC" || tries >= 40)
        throw e;
      console.error(
        `disk full writing ${path.basename(file)}; trying again in 30 s`,
      );
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

let spent = 0;

type Checkpoint = {
  turn: number;
  items: unknown[];
  lists: Record<string, string[]>;
};

function snapshot(s: Store, turn: number): Checkpoint {
  const l = listsOf(s);
  return {
    turn,
    items: [...s.items.values()].map((i) => structuredClone(i)),
    lists: Object.fromEntries(
      Object.entries(l).map(([k, v]) => [k, v.map((i) => i.id)]),
    ),
  };
}

async function run(file: string) {
  const conv = path.basename(file, ".jsonl");
  const dir = path.join(OUT, conv);
  const done = path.join(dir, "checkpoints.json");
  if (fs.existsSync(done)) {
    const prev = JSON.parse(fs.readFileSync(done, "utf8")) as {
      complete?: boolean;
    };
    if (prev.complete && !fresh) {
      console.log(`${conv}: already filed`);
      return;
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  let turns = await turnsOf(file);
  if (turnCap) turns = turns.slice(0, turnCap);
  const marks = [1, 2, 3, 4, 5].map(
    (k) => turns[Math.max(0, Math.round((turns.length * k) / 5) - 1)]!.n,
  );
  const s = emptyStore(conv, path.basename(path.dirname(file)));
  const checkpoints: Checkpoint[] = [];
  const log = fs.createWriteStream(path.join(dir, "log.jsonl"));
  // a full disk loses log lines, never the run
  log.on("error", () => {});
  const spend = {
    calls: 0,
    usd: 0,
    ms: 0,
    input: 0,
    output: 0,
    rejected: 0,
    failed: 0,
  };
  let model_ = "";
  for (const batch of batches(turns)) {
    if (spent >= maxUsd) {
      console.log(
        `stopping: $${spent.toFixed(2)} spent, the cap is $${maxUsd}`,
      );
      break;
    }
    const r = await provider.extract!({
      system: SYSTEM,
      message: message(s, batch),
      schema: SCHEMA as unknown as Record<string, unknown>,
      model,
      timeoutMs: 180_000,
    });
    spend.calls++;
    spend.ms += r.ms;
    spend.usd += r.usage?.costUsd ?? 0;
    spend.input += r.usage?.input ?? 0;
    spend.output += r.usage?.output ?? 0;
    spent += r.usage?.costUsd ?? 0;
    model_ ||= r.usage?.model ?? "";
    let rejected: unknown[] = [];
    if (r.ok) {
      const out = apply(s, r.value as Answer, batch);
      rejected = out.rejected;
      spend.rejected += out.rejected.length;
    } else {
      spend.failed++;
      // a failed batch is skipped, as live it would be tried again later
      s.read = Math.max(s.read, ...batch.map((t) => t.n));
    }
    log.write(
      `${JSON.stringify({ turns: batch.map((t) => t.n), ok: r.ok, error: r.error, answer: r.value, rejected, usd: r.usage?.costUsd, ms: r.ms })}\n`,
    );
    for (const m of marks)
      if (
        batch.some((t) => t.n === m) &&
        !checkpoints.some((c) => c.turn === m)
      )
        checkpoints.push(snapshot(s, m));
    await save(
      done,
      JSON.stringify(
        {
          conv,
          file,
          model: model_ || model || "default",
          turns: turns.length,
          checkpoints,
          spend,
          complete: false,
        },
        null,
        1,
      ),
    );
  }
  log.end();
  const complete = checkpoints.length === marks.length;
  await save(
    done,
    JSON.stringify(
      {
        conv,
        file,
        model: model_ || model || "default",
        turns: turns.length,
        checkpoints,
        spend,
        complete,
      },
      null,
      1,
    ),
  );
  await save(
    path.join(dir, "map.mmd"),
    toMermaid(toMapItems(s), { title: s.title, conv, seq: s.read }),
  );
  await save(path.join(dir, "page.html"), page(s));
  const l = listsOf(s);
  console.log(
    `${conv}: ${turns.length} turns, ${spend.calls} calls, $${spend.usd.toFixed(2)}, ${(spend.ms / 1000).toFixed(0)} s, ${s.items.size} items (${spend.rejected} changes rejected, ${spend.failed} calls failed); waiting ${l.waiting.length}, open ${l.open.length}`,
  );
}

// A static page of one chat's map, to show a friend: the lists first, then
// the mind map drawn by Mermaid.
function page(s: Store): string {
  const l = listsOf(s);
  const esc = (x: string) =>
    x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = (
    name: string,
    items: { id: string; title: string; src: number[] }[],
  ) =>
    `<h2>${name} (${items.length})</h2><ul>${items.map((i) => `<li>${esc(i.title)} <small>${i.id} · turn ${i.src.join(", ")}</small></li>`).join("")}</ul>`;
  return `<!doctype html><meta charset="utf-8"><title>${esc(s.title)}</title>
<style>body{font:14px/1.5 system-ui;margin:24px;max-width:960px}small{color:#777}</style>
<h1>${esc(s.title)}</h1>
${list("Waiting on you", l.waiting)}${list("Open", l.open)}${list("Decided", l.decided)}${list("Options taken", l.taken)}
<h2>Map</h2><pre class="mermaid">${esc(toMermaid(toMapItems(s), { title: s.title, conv: s.conv, seq: s.read }))}</pre>
<script type="module">import m from "https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.esm.min.mjs";m.initialize({startOnLoad:true,securityLevel:"strict"});</script>`;
}

const files = pick ? await choose(pick) : paths;
if (!files.length) {
  console.log("Give transcript paths, or --pick N.");
  process.exit(1);
}
console.log(`${files.length} chats, cap $${maxUsd}`);
for (const f of files) await run(f);
console.log(`spent $${spent.toFixed(2)}`);
