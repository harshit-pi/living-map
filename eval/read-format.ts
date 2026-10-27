// Does a model answer questions about a map as well from mermaid+ as from one
// line per item? The same synthetic map (ledger/fixtures/map.ts) in both
// forms, 20 questions whose answers are sets of item ids, checked exactly.
// It calls the model: 40 calls on Claude Code's default model unless
// LIVING_MAP_EVAL_MODEL names another (only when asked; about $0.50 on Opus).
//
//   node eval/read-format.ts            → eval/read-format-results.md

import fs from "node:fs";
import path from "node:path";

import { HEADER, ITEMS, QUESTIONS } from "../ledger/fixtures/map.ts";
import { toLines, toMermaid } from "../ledger/mermaid.ts";
import { HOME } from "../server/config.ts";
import { claudeCode } from "../server/providers/claude-code.ts";

// $LIVING_MAP_HOME when set, like the server and the scorer, so two runs
// can each keep their own folder
const home = HOME;
const provider = claudeCode({ home });
const model = process.env.LIVING_MAP_EVAL_MODEL ?? "";

const FORMS = {
  "mermaid+": toMermaid(ITEMS, HEADER),
  "one line per item": toLines(ITEMS, HEADER),
};

const SYSTEM = `You answer questions about a map of one conversation. Every item has an id (i<n>), a type, a state and a parent. Answer only through the schema: the ids of the items that answer the question, or an empty list when none do.`;
const SCHEMA = {
  type: "object",
  properties: { ids: { type: "array", items: { type: "string" } } },
  required: ["ids"],
  additionalProperties: false,
};

type Row = {
  form: string;
  q: string;
  want: string[];
  got: string[];
  exact: boolean;
  ms: number;
  input: number;
  costUsd: number;
  model: string;
  error?: string;
};

async function ask(form: string, text: string, q: string, want: string[]) {
  const r = await provider.extract!({
    system: SYSTEM,
    message: `MAP:\n${text}\n\nQUESTION: ${q}`,
    schema: SCHEMA,
    model,
    timeoutMs: 120_000,
  });
  const got = r.ok
    ? [...new Set(((r.value as { ids?: unknown })?.ids as string[]) ?? [])]
    : [];
  const same =
    r.ok && got.length === want.length && want.every((id) => got.includes(id));
  return {
    form,
    q,
    want,
    got,
    exact: same,
    ms: r.ms,
    input: r.usage?.input ?? 0,
    costUsd: r.usage?.costUsd ?? 0,
    model: r.usage?.model ?? "",
    error: r.error,
  } satisfies Row;
}

// a few at a time: enough to finish in a minute or two without tripping limits
async function pool<T>(jobs: (() => Promise<T>)[], size = 4): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < jobs.length) {
        const n = next++;
        out[n] = await jobs[n]!();
      }
    }),
  );
  return out;
}

const jobs = Object.entries(FORMS).flatMap(([form, text]) =>
  QUESTIONS.map(
    ({ q, ids }) =>
      () =>
        ask(form, text, q, ids),
  ),
);
const rows = await pool(jobs);

const lines: string[] = [
  "# Reading eval: mermaid+ against one line per item",
  "",
  `Model: ${rows.find((r) => r.model)?.model ?? (model || "Claude Code's default")}. ${QUESTIONS.length} questions on a ${ITEMS.length}-item synthetic map (\`ledger/fixtures/map.ts\`), answers checked as exact id sets.`,
  "",
  "| Form | Characters | Exact | Avg input tokens | Avg time | Cost |",
  "|---|---|---|---|---|---|",
];
for (const [form, text] of Object.entries(FORMS)) {
  const rs = rows.filter((r) => r.form === form);
  const avg = (f: (r: Row) => number) =>
    rs.reduce((s, r) => s + f(r), 0) / rs.length;
  lines.push(
    `| ${form} | ${text.length} | ${rs.filter((r) => r.exact).length}/${rs.length} | ${Math.round(avg((r) => r.input))} | ${(avg((r) => r.ms) / 1000).toFixed(1)} s | $${rs.reduce((s, r) => s + r.costUsd, 0).toFixed(3)} |`,
  );
}
lines.push("", "## Misses", "");
for (const r of rows.filter((r) => !r.exact))
  lines.push(
    `- **${r.form}**: ${r.q} wanted ${r.want.join(", ") || "none"}, got ${r.got.join(", ") || "none"}${r.error ? ` (${r.error})` : ""}`,
  );
if (rows.every((r) => r.exact)) lines.push("None.");

const file = path.join(import.meta.dirname, "read-format-results.md");
fs.writeFileSync(file, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
