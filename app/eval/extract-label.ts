// Labels for the extractor eval: Opus reads a chat up to each checkpoint the
// runner saved and writes down, by its own reading, what waits on you, what
// is still open, what was decided and which options were taken. The scorer
// (eval/extract-score.ts) compares the map's lists against these. It calls
// the model once per checkpoint not yet labelled (Opus; only when asked).
//
//   node eval/extract-label.ts [--fresh] <conv dir>...
//
// Each <conv dir> is ~/.living-map/eval/extract/<conv>/, holding the
// runner's checkpoints.json; labels.json is written beside it after every
// checkpoint, so a run that stops can be started again.

import fs from "node:fs";
import path from "node:path";

import type { Item } from "../ledger/items.ts";
import {
  type Label,
  type LabelLists,
  LIST_NAMES,
  type ListName,
} from "../ledger/match.ts";
import {
  emptyTranscript,
  readMore,
  type Turn,
  view,
} from "../ledger/transcript.ts";
import { HOME } from "../server/config.ts";
import { claudeCode } from "../server/providers/claude-code.ts";

// the runner's output, as far as the labeler and scorer read it
export type Checkpoints = {
  conv: string;
  file: string;
  model: string;
  turns: number;
  checkpoints: {
    turn: number;
    items: Item[]; // all of them, retired too
    lists: Record<ListName, string[]>;
  }[];
  spend?: { calls: number; usd: number };
};

export type LabelledCheckpoint = {
  turn: number;
  lists: LabelLists;
  // the first turn the labeler saw: above 1 when the chat was cut to fit
  from: number;
  chars: number;
  cut?: string;
  dropped: number; // entries thrown out for naming a turn it wasn't shown
  model: string;
  usd: number;
  input: number;
  output: number;
  ms: number;
};

export type Labels = {
  conv: string;
  file: string;
  labeller: string;
  checkpoints: LabelledCheckpoint[];
};

const MODEL = "opus";
const EFFORT = "medium";
const MAX_CHARS = 600_000;
const POOL = Number(process.env.LIVING_MAP_EVAL_POOL) || 3;

export const LABEL_SYSTEM = `You label a conversation between a person (YOU) and Claude Code (CLAUDE), a coding assistant, to check a tool that keeps track of it. You read the conversation up to some turn and write down where things stand as of the last turn shown: not where they stood earlier, and not where they will end up.

Write four lists.

waiting: what the person must do before the work can go on: answer a question Claude asked them, choose between options Claude offered, confirm or approve something, or supply something (a file, a value, an access, a decision). Also asks the person made of themselves that are still open, and questions only the person can answer (their preferences, their plans, facts about their setup). An entry leaves waiting once the person answers, chooses, supplies it or says to drop it, even in passing, or once Claude goes ahead without needing it. Steps only the person can do (merge or review a PR, deploy, run a command Claude handed over, test on their own device, contact someone, fill a form) are waiting, not open, until the person says they did them or a later turn shows they happened. An optional offer ("if you want, I can…", "say so and I'll…") is waiting only until the person's next message; if they don't take it up, it is gone. When the person picks some items from a list, the rest are no longer waiting.

open: what is not settled and not already in waiting: questions not yet answered (including ones Claude said it will look into), tasks not done by either side (asked for, planned or promised and not finished or reported done; a problem Claude names as still unfixed or not yet tried counts as a task), and assumptions either side made and nobody confirmed. A decision the person reopened and has not settled again is open. Do not list here what is in waiting; it is counted as open already.

decided: decisions in force as of the last turn: what the person or Claude settled on (an approach, a tool, a name, a scope, a rule) and nobody has reversed. A decision later replaced is not listed; the one that replaced it is.

taken: options that were offered and taken: Claude (or the person) laid out at least two alternatives and one was picked. The person saying yes to a single proposal ("Want me to…?") is not an option taken: that was an ask, and it left waiting when they answered. Give the option picked as the title and the question it answered as question.

For each entry:
- title: a short title in the conversation's own words, at most 12 words, the way a to-do list or decision log would name it ("Confirm the deploy region", "Use SQLite for the store").
- turn: the TURN number that puts it in its list: where the ask, question, task or assumption was raised; where the decision was made; where the option was taken.
- note: optional, a few words when the title alone is unclear.

One entry per distinct thing: do not split one ask into its parts, and do not merge separate asks into one. Skip small talk, Claude narrating what it is doing right now, tool chatter, and anything finished. Claude's own working steps inside one turn are not tasks unless they were left unfinished when the turn ended.

List nothing you can't point to a turn for. If a list has nothing, give an empty list.`;

const entry = (
  extra: Record<string, unknown> = {},
  required: string[] = [],
) => ({
  type: "object",
  properties: {
    title: { type: "string" },
    turn: { type: "integer" },
    note: { type: "string" },
    ...extra,
  },
  required: ["title", "turn", ...required],
  additionalProperties: false,
});
const SCHEMA = {
  type: "object",
  properties: {
    waiting: { type: "array", items: entry() },
    open: { type: "array", items: entry() },
    decided: { type: "array", items: entry() },
    taken: {
      type: "array",
      items: entry({ question: { type: "string" } }, ["question"]),
    },
  },
  required: [...LIST_NAMES],
  additionalProperties: false,
};

// the start and end of a long message: asks tend to come last, context first
function clip(s: string, head: number, tail: number): string {
  if (s.length <= head + tail) return s;
  const cut = s.length - head - tail;
  return `${s.slice(0, head)}\n[… ${cut.toLocaleString("en")} characters cut …]\n${s.slice(-tail)}`;
}

const renderTurn = (t: Turn) =>
  `TURN ${t.n} · YOU:\n${clip(t.text.trim(), 2000, 4000)}\n\nTURN ${t.n} · CLAUDE:\n${clip(t.reply.trim(), 2000, 4000) || "(no words)"}`;

// Turns 1..upTo as text; when that is too long the oldest turns go, whole.
export function render(turns: Turn[], upTo: number) {
  const parts = turns.filter((t) => t.n <= upTo).map(renderTurn);
  let chars = parts.reduce((s, p) => s + p.length + 2, 0);
  const all = chars;
  let first = 0;
  while (chars > MAX_CHARS && first < parts.length - 1)
    chars -= parts[first++]!.length + 2;
  const from = turns.filter((t) => t.n <= upTo)[first]?.n ?? 1;
  const cut =
    first > 0
      ? `The chat up to turn ${upTo} is ${all.toLocaleString("en")} characters; turns 1–${from - 1} were left out to keep the last ${chars.toLocaleString("en")}.`
      : undefined;
  return { text: parts.slice(first).join("\n\n"), from, chars, cut };
}

// The model's answer is untrusted: keep entries with a title and a turn it
// was shown, once each.
export function cleanLists(raw: unknown, from: number, upTo: number) {
  const out = { waiting: [], open: [], decided: [], taken: [] } as LabelLists;
  let dropped = 0;
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const name of LIST_NAMES) {
    const seen = new Set<string>();
    for (const e of Array.isArray(r[name]) ? (r[name] as unknown[]) : []) {
      const o = (e ?? {}) as Record<string, unknown>;
      const title =
        typeof o.title === "string"
          ? o.title.replace(/\s+/g, " ").trim().slice(0, 200)
          : "";
      const turn = typeof o.turn === "number" ? Math.round(o.turn) : NaN;
      if (!title || !(turn >= from && turn <= upTo)) {
        dropped++;
        continue;
      }
      const k = `${turn}|${title.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const label: Label = { title, turn };
      if (typeof o.note === "string" && o.note.trim())
        label.note = o.note.replace(/\s+/g, " ").trim().slice(0, 300);
      if (name === "taken")
        label.question =
          typeof o.question === "string"
            ? o.question.replace(/\s+/g, " ").trim().slice(0, 200)
            : "";
      out[name].push(label);
    }
  }
  return { lists: out, dropped };
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

async function turnsOf(file: string): Promise<Turn[]> {
  const t = emptyTranscript();
  await readMore(t, file);
  return view(t, 0).turns;
}

async function pool(jobs: (() => Promise<void>)[], size: number) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < jobs.length) await jobs[next++]!();
    }),
  );
}

async function main(dirs: string[]) {
  if (!dirs.length) {
    console.error("usage: node eval/extract-label.ts <conv dir>...");
    process.exit(2);
  }
  const provider = claudeCode({ home: HOME, cwd: HOME });
  const fresh = dirs.includes("--fresh");
  dirs = dirs.filter((d) => d !== "--fresh");
  let total = 0;
  const jobs: (() => Promise<void>)[] = [];
  for (const dir of dirs) {
    const cps = readJson<Checkpoints>(path.join(dir, "checkpoints.json"));
    if (!cps) {
      console.error(`${dir}: no checkpoints.json`);
      continue;
    }
    const out = path.join(dir, "labels.json");
    // --fresh labels again, after a change to the definitions
    const prior = fresh ? null : readJson<Labels>(out);
    const labels: Labels = prior ?? {
      conv: cps.conv,
      file: cps.file,
      labeller: MODEL,
      checkpoints: [],
    };
    const done = new Set(labels.checkpoints.map((c) => c.turn));
    const todo = cps.checkpoints.filter((c) => !done.has(c.turn));
    if (!todo.length) {
      console.log(`${cps.conv}: all ${done.size} checkpoints labelled`);
      continue;
    }
    const turns = turnsOf(cps.file);
    for (const cp of todo)
      jobs.push(async () => {
        const { text, from, chars, cut } = render(await turns, cp.turn);
        const r = await provider.extract!({
          system: LABEL_SYSTEM,
          message: `${cut ? `${cut}\n\n` : ""}THE CONVERSATION, TURNS ${from}–${cp.turn}:\n\n${text}\n\nWrite the four lists as of turn ${cp.turn}.`,
          schema: SCHEMA,
          model: MODEL,
          effort: EFFORT,
          timeoutMs: 15 * 60_000,
        });
        const usd = r.usage?.costUsd ?? 0;
        total += usd;
        const tag = `${cps.conv.slice(0, 8)} t${cp.turn}`;
        if (!r.ok) {
          console.log(`${tag}: failed (${r.error}) · $${usd.toFixed(3)}`);
          return;
        }
        const { lists, dropped } = cleanLists(r.value, from, cp.turn);
        labels.checkpoints.push({
          turn: cp.turn,
          lists,
          from,
          chars,
          cut,
          dropped,
          model: r.usage?.model ?? MODEL,
          usd,
          input: r.usage?.input ?? 0,
          output: r.usage?.output ?? 0,
          ms: r.ms,
        });
        labels.checkpoints.sort((a, b) => a.turn - b.turn);
        fs.writeFileSync(out, `${JSON.stringify(labels, null, 2)}\n`);
        const counts = LIST_NAMES.map((n) => `${lists[n].length} ${n}`).join(
          ", ",
        );
        console.log(
          `${tag}: ${counts}${dropped ? ` (${dropped} dropped)` : ""} · ${Math.round(chars / 1000)}k chars${cut ? " (cut)" : ""} · ${r.usage?.input ?? 0} in / ${r.usage?.output ?? 0} out · $${usd.toFixed(3)} · ${(r.ms / 1000).toFixed(0)} s`,
        );
      });
  }
  await pool(jobs, POOL);
  if (jobs.length) console.log(`total: $${total.toFixed(3)}`);
}

if (import.meta.main) await main(process.argv.slice(2));
