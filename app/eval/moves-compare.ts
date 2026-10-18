// Runs of eval/moves.ts side by side, per kind of move.
//
//   node eval/moves-compare.ts baseline after   → eval/moves-results.md

import fs from "node:fs";

type Call = {
  move: string;
  label: string;
  out: number;
  firstMs: number;
  endMs: number;
  cost: number;
  warm: boolean | null;
  opsBroken: number;
  chars: number;
};
type Run = {
  label: string;
  cost: number;
  calls: Call[];
  quality: Record<string, unknown>[];
};

const labels = process.argv.slice(2);
const runs: Run[] = labels.map((l) =>
  JSON.parse(
    fs.readFileSync(new URL(`./moves-${l}.json`, import.meta.url), "utf8"),
  ),
);

// a start's second try is a move of its own
const kind = (c: Call) =>
  c.label.includes("second try")
    ? "learn retry"
    : c.move.replace(/ \((concept|algorithm|history)\)$/, "");
const kinds = [...new Set(runs.flatMap((r) => r.calls.map(kind)))];
const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const lines: string[] = [
  `| Move | ${labels.map((l) => `${l}: out tokens · reply chars · first word · total (n)`).join(" | ")} |`,
  `|---|${labels.map(() => "---").join("|")}|`,
];
for (const k of kinds)
  lines.push(
    `| ${k} | ${runs
      .map((r) => {
        const cs = r.calls.filter((c) => kind(c) === k);
        if (!cs.length) return "-";
        return `${Math.round(avg(cs.map((c) => c.out)))} · ${Math.round(avg(cs.map((c) => c.chars)))} · ${s(avg(cs.map((c) => c.firstMs)))} · ${s(avg(cs.map((c) => c.endMs)))} (${cs.length})`;
      })
      .join(" | ")} |`,
  );

// quality, per run
const q = (r: Run, move: RegExp) =>
  r.quality.filter((x) => move.test(String(x.move)));
lines.push(
  "",
  `| Signal | ${labels.join(" | ")} |`,
  `|---|${labels.map(() => "---").join("|")}|`,
);
const row = (name: string, f: (r: Run) => string) =>
  lines.push(`| ${name} | ${runs.map(f).join(" | ")} |`);
const count = (
  xs: Record<string, unknown>[],
  f: (x: Record<string, unknown>) => boolean,
) => `${xs.filter(f).length}/${xs.length}`;
row("Learn: model held on the first try", (r) =>
  count(q(r, /^learn/), (x) => x.status === "ready" && !x.retried),
);
row("Learn: model ready in the end", (r) =>
  count(q(r, /^learn/), (x) => x.status === "ready"),
);
row("Learn: predict kept after the giveaway scrub", (r) =>
  count(q(r, /^learn/), (x) => x.predict === true),
);
row("Learn: every key link kept its hint", (r) =>
  count(q(r, /^learn/), (x) => x.keys === x.keysWithHint),
);
row("Learn: what-if present", (r) =>
  count(q(r, /^learn/), (x) => x.whatif === true),
);
row("Learn: parts / links / key links (mean)", (r) => {
  const xs = q(r, /^learn/);
  const m = (k: string) => avg(xs.map((x) => Number(x[k] ?? 0))).toFixed(1);
  return `${m("parts")} / ${m("links")} / ${m("keys")}`;
});
row("Explore start: frame as expected (choose, causes)", (r) =>
  count(q(r, /^explore start/), (x) =>
    String(x.move).includes("choice")
      ? x.shape === "choose"
      : x.shape === "causes",
  ),
);
row("Explore start: options / wants (mean)", (r) => {
  const xs = q(r, /^explore start/);
  return `${avg(xs.map((x) => Number(x.options))).toFixed(1)} / ${avg(xs.filter((x) => x.shape === "choose").map((x) => Number(x.wants))).toFixed(1)}`;
});
row("Explore start: stand written", (r) =>
  count(q(r, /^explore start/), (x) => x.stand === true),
);
row(
  "Explore fill: cells filled of options × wants",
  (r) =>
    q(r, /^explore fill/)
      .map((x) => `${x.cells}/${Number(x.options) * Number(x.wants)}`)
      .join(", ") || "-",
);
row(
  "Explore deeper: nodes added",
  (r) =>
    q(r, /^explore deeper/)
      .map((x) => String(x.added))
      .join(", ") || "-",
);
row("Ops that could not be read", (r) =>
  String(r.calls.reduce((a, c) => a + c.opsBroken, 0)),
);
row("Calls on a process started ahead", (r) => {
  const known = r.calls.filter((c) => c.warm !== null);
  return known.length
    ? `${known.filter((c) => c.warm).length}/${known.length}`
    : "(no spare)";
});
row("Eval cost", (r) => `$${r.cost.toFixed(2)}`);

fs.writeFileSync(
  new URL("./moves-results.md", import.meta.url),
  `${lines.join("\n")}\n`,
);
console.log(lines.join("\n"));
