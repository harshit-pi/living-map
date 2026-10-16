// Does Learn pick a fitting, concrete diagram for the question, and how fast?
// Runs the real opening move (same prompt as the server, through the same
// model provider) on varied questions, at high effort and at low effort.
//
//   node eval/forms.ts            → eval/forms-results.json and .md

import fs from "node:fs";

import { HOME, MODEL_CWD, PROVIDER } from "../server/config.ts";
import { applyOps, outline } from "../server/core/canvas.ts";
import { diagramOutline } from "../server/core/diagram.ts";
import { systemPrompt, viewLine } from "../server/core/prompts.ts";
import { completeOps } from "../server/core/reply.ts";
import { startAction } from "../server/core/start.ts";
import type { Canvas } from "../server/core/types.ts";
import { pickProvider } from "../server/providers/index.ts";
import type { DiagramForm } from "../shared/model.ts";

const provider = pickProvider(PROVIDER, { home: HOME, cwd: MODEL_CWD });

// question → forms a careful teacher would accept
const QUESTIONS: [string, DiagramForm[]][] = [
  ["How does the TLS handshake set up an encrypted connection?", ["sequence"]],
  [
    "How does photosynthesis turn light into sugar?",
    ["concept", "structure", "sequence"],
  ],
  ["How did the French Revolution unfold, 1789–1799?", ["timeline"]],
  ["How does a B-tree index find a row?", ["structure"]],
  ["REST vs GraphQL vs gRPC: when to use which?", ["grid"]],
  [
    "How does compound interest grow savings over 30 years?",
    ["grid", "timeline", "concept"],
  ],
  [
    "What does git rebase do differently from merge?",
    ["structure", "sequence"],
  ],
  ["LeetCode 200: Number of Islands", ["grid", "structure"]],
  [
    "How does the immune system fight a new virus?",
    ["sequence", "concept", "timeline"],
  ],
  ["How do supply and demand settle a price?", ["concept", "grid"]],
  [
    "Bayes' theorem: what does a positive medical test really mean?",
    ["grid", "concept", "structure"],
  ],
  ["How did JavaScript module systems evolve?", ["timeline"]],
];
const EFFORTS = ["high", "low"];

type Result = {
  question: string;
  effort: string;
  ms: number;
  firstMs: number;
  out: number;
  cost: number;
  form: DiagramForm | null;
  title: string;
  diagram: string;
  steps: string[];
};

async function run(question: string, effort: string): Promise<Result> {
  const message = [
    `CANVAS (learning path):\n${outline({})}`,
    `TOPIC DIAGRAM:\n${diagramOutline(null, {})}`,
    `ACTION: ${startAction("learn", question)}`,
    viewLine("visual"),
  ].join("\n\n");
  const reply = await provider.run(
    { system: systemPrompt("learn", ["diagram"]), message, effort },
    () => {},
  ).reply;
  const usage = await reply.usage;
  const m: Canvas = { nodes: {}, diagram: null, fills: {} };
  applyOps(m, completeOps(reply.final));
  return {
    question,
    effort,
    ms: reply.endMs,
    firstMs: reply.firstMs,
    out: usage?.output ?? 0,
    cost: usage?.costUsd ?? 0,
    form: m.diagram?.form ?? null,
    title: m.diagram?.title ?? "",
    diagram: m.diagram ? diagramOutline(m.diagram, {}) : "(none)",
    steps: Object.values(m.nodes)
      .filter((n) => n.parent)
      .map((n) => n.title),
  };
}

const jobs = QUESTIONS.flatMap(([q]) => EFFORTS.map((e) => [q, e] as const));
const results: Result[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const [q, e] = jobs[next++];
      const r = await run(q, e);
      results.push(r);
      console.log(
        `${(r.ms / 1000).toFixed(0)}s first ${(r.firstMs / 1000).toFixed(1)}s ${r.effort} ${r.form} — ${q}`,
      );
    }
  }),
);

const fits = (r: Result) =>
  !!r.form &&
  (QUESTIONS.find(([q]) => q === r.question)?.[1] ?? []).includes(r.form);
const find = (q: string, e: string) =>
  results.find((r) => r.question === q && r.effort === e);
const cell = (r?: Result) =>
  r
    ? `${r.form}${fits(r) ? "" : " ✗"} · ${(r.ms / 1000).toFixed(0)}s (${(r.firstMs / 1000).toFixed(1)}s)`
    : "-";
const avg = (e: string, k: "ms" | "firstMs") =>
  (
    results.filter((r) => r.effort === e).reduce((a, r) => a + r[k], 0) /
    QUESTIONS.length /
    1000
  ).toFixed(1);
const fitCount = (e: string) =>
  results.filter((r) => r.effort === e && fits(r)).length;

fs.writeFileSync(
  new URL("./forms-results.json", import.meta.url),
  JSON.stringify(results, null, 1),
);
fs.writeFileSync(
  new URL("./forms-results.md", import.meta.url),
  [
    "| Question | Fits | High effort: form · time (first words) | Low effort |",
    "|---|---|---|---|",
    ...QUESTIONS.map(
      ([q, want]) =>
        `| ${q} | ${want.join("/")} | ${cell(find(q, "high"))} | ${cell(find(q, "low"))} |`,
    ),
    "",
    `Average: high ${avg("high", "ms")}s (first ${avg("high", "firstMs")}s); low ${avg("low", "ms")}s (first ${avg("low", "firstMs")}s).`,
    `Fit: high ${fitCount("high")}/12, low ${fitCount("low")}/12. Cost $${results.reduce((a, r) => a + r.cost, 0).toFixed(2)}.`,
    "",
    ...results
      .sort(
        (a, b) =>
          a.question.localeCompare(b.question) ||
          a.effort.localeCompare(b.effort),
      )
      .map(
        (r) =>
          `### ${r.question} (${r.effort})\nSteps: ${r.steps.join(" · ")}\n\n\`\`\`\n${r.diagram}\n\`\`\`\n`,
      ),
  ].join("\n"),
);
console.log("done");
