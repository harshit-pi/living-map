// Scores the extractor against the labels: per chat, a settle.md with every
// place the map and the labeler disagree, one line each with three boxes to
// tick, and recall and precision of each list before and after those marks.
// The gate is the waiting list: at least 80% of what waits on you found,
// with at least 90% precision. Word matching pairs most entries; where it
// leaves both sides of a list unpaired, one model call pairs what refers to
// the same thing in other words (cached in pairs.json, so a rerun is free).
//
//   node eval/extract-score.ts [<conv dir>...]
//
// With no dirs it scores every chat under ~/.living-map/eval/extract/ (or
// $LIVING_MAP_HOME/eval/extract/) that has both checkpoints.json and
// labels.json. Running it again keeps the
// marks already in each settle.md (lines are matched by the key in their
// HTML comment) and appends the summary to summary.md there.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Checkpoints, Labels } from "./extract-label.ts";
import type { Item } from "../ledger/items.ts";
import {
  asListed,
  LIST_NAMES,
  type Label,
  type ListName,
  type Match,
  matchLists,
} from "../ledger/match.ts";
import { HOME } from "../server/config.ts";
import { claudeCode } from "../server/providers/claude-code.ts";

const ROOT = path.join(HOME, "eval", "extract");
const GATE = { recall: 0.8, precision: 0.9 };

type Mark = "map" | "label" | "both";
type Counts = { tp: number; fp: number; fn: number };
type Score = Record<ListName, { before: Counts; after: Counts }>;

const BOXES =
  /\[([ xX])\]\s*map right\s*\[([ xX])\]\s*label right\s*\[([ xX])\]\s*both wrong/;
const KEY = /<!-- k:(\S+) -->/;

// Marks already made, by key; a line with more than one box ticked counts as
// unmarked, as nobody can tell which was meant.
export function readMarks(md: string) {
  const marks = new Map<string, { mark: Mark; line: string }>();
  for (const line of md.split("\n")) {
    const k = KEY.exec(line)?.[1];
    const b = BOXES.exec(line);
    if (!k || !b) continue;
    const ticked = (["map", "label", "both"] as const).filter(
      (_, i) => b[i + 1] !== " ",
    );
    if (ticked.length === 1) marks.set(k, { mark: ticked[0]!, line });
  }
  return marks;
}

const zero = (): Counts => ({ tp: 0, fp: 0, fn: 0 });
const add = (a: Counts, b: Counts) => {
  a.tp += b.tp;
  a.fp += b.fp;
  a.fn += b.fn;
};
const emptyScore = (): Score =>
  Object.fromEntries(
    LIST_NAMES.map((n) => [n, { before: zero(), after: zero() }]),
  ) as Score;

const recall = (c: Counts) => (c.tp + c.fn ? c.tp / (c.tp + c.fn) : null);
const precision = (c: Counts) => (c.tp + c.fp ? c.tp / (c.tp + c.fp) : null);
const pct = (x: number | null) =>
  x === null ? "—" : `${Math.round(x * 100)}%`;
const passes = (c: Counts) =>
  (recall(c) ?? 1) >= GATE.recall && (precision(c) ?? 1) >= GATE.precision;

// Before settling the labels are the truth. After: a map-only line marked
// map right was found; label right (or unmarked) is a false alarm; both
// wrong is a false alarm and also something real that neither has. A
// label-only line marked map right is no miss; any other mark is a miss.
export function count(
  m: Match,
  mapMarks: (Mark | undefined)[],
  labelMarks: (Mark | undefined)[],
) {
  const before: Counts = {
    tp: m.pairs.length,
    fp: m.mapOnly.length,
    fn: m.labelOnly.length,
  };
  const after: Counts = { tp: m.pairs.length, fp: 0, fn: 0 };
  for (const mark of mapMarks) {
    if (mark === "map") after.tp++;
    else after.fp++;
    if (mark === "both") after.fn++;
  }
  for (const mark of labelMarks) if (mark !== "map") after.fn++;
  return { before, after };
}

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .replace(/<!--|-->/g, "")
    .trim();
const turns = (i: Item) =>
  i.src.length ? i.src.map((n) => `t${n}`).join(",") : "no turn";
const mapText = (i: Item) => `"${clean(i.title)}" (${i.id}, ${turns(i)})`;
const labelText = (l: Label) =>
  `"${clean(l.title)}" (t${l.turn}${l.question ? `, for "${clean(l.question)}"` : ""})${l.note ? ` — ${clean(l.note)}` : ""}`;
const hash = (s: string) =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
const labelKey = (cp: number, list: ListName, l: Label) =>
  `t${cp}.${list}.label.${hash(`${l.turn}|${l.title.toLowerCase().replace(/\s+/g, " ").trim()}`)}`;
const box = (want: Mark, mark?: Mark) => (mark === want ? "[x]" : "[ ]");
const boxes = (mark?: Mark) =>
  `- ${box("map", mark)} map right  ${box("label", mark)} label right  ${box("both", mark)} both wrong`;

function scoreTable(s: Score): string[] {
  const rows = [
    "| List | Recall before | after | Precision before | after | Found / missed / false (after) |",
    "|---|---|---|---|---|---|",
  ];
  for (const n of LIST_NAMES) {
    const { before: b, after: a } = s[n];
    rows.push(
      `| ${n} | ${pct(recall(b))} | ${pct(recall(a))} | ${pct(precision(b))} | ${pct(precision(a))} | ${a.tp} / ${a.fn} / ${a.fp} |`,
    );
  }
  return rows;
}

type Result = {
  conv: string;
  checkpoints: number;
  score: Score;
  lines: number;
  marked: number;
  model: string;
  labeller: string;
};

const PAIR_SYSTEM = `Two lists of entries about the same conversation: MAP (what a tool filed) and LABEL (what a reviewer wrote down). Pair the entries that refer to the same thing (the same ask, question, task, decision or option), even when worded differently or a few turns apart. Pair only what is clearly the same; leave the rest unpaired. Each entry is used at most once.`;
const PAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pairs"],
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["map", "label"],
        properties: { map: { type: "string" }, label: { type: "integer" } },
      },
    },
  },
};
let provider: ReturnType<typeof claudeCode> | null = null;

// What word matching left unpaired on both sides, paired by meaning.
async function refine(
  m: Record<ListName, Match>,
  turn: number,
  cache: Record<string, { map: string; label: number }[]>,
): Promise<number> {
  let usd = 0;
  for (const n of LIST_NAMES) {
    const lm = m[n];
    if (!lm.mapOnly.length || !lm.labelOnly.length) continue;
    const text = [
      "MAP:",
      ...lm.mapOnly.map(
        (i) => `${i.id} · turn ${i.src.join(",")} · ${i.title}`,
      ),
      "",
      "LABEL:",
      ...lm.labelOnly.map(
        (l, k) =>
          `${k} · turn ${l.turn} · ${l.title}${l.note ? ` (${l.note})` : ""}`,
      ),
    ].join("\n");
    const key = crypto
      .createHash("sha1")
      .update(`${turn}|${n}|${text}`)
      .digest("hex");
    let pairs = cache[key];
    if (!pairs) {
      provider ??= claudeCode({ home: HOME, cwd: HOME });
      const r = await provider.extract!({
        system: PAIR_SYSTEM,
        message: text,
        schema: PAIR_SCHEMA,
        timeoutMs: 120_000,
      });
      usd += r.usage?.costUsd ?? 0;
      if (!r.ok) continue;
      pairs = (r.value as { pairs: { map: string; label: number }[] }).pairs;
      cache[key] = pairs;
    }
    const usedI = new Set<string>();
    const usedL = new Set<number>();
    for (const p of pairs) {
      const item = lm.mapOnly.find((i) => i.id === p.map);
      const label = lm.labelOnly[p.label];
      if (!item || !label || usedI.has(item.id) || usedL.has(p.label)) continue;
      usedI.add(item.id);
      usedL.add(p.label);
      lm.pairs.push({ item, label, score: 0 });
    }
    lm.mapOnly = lm.mapOnly.filter((i) => !usedI.has(i.id));
    lm.labelOnly = lm.labelOnly.filter((_, k) => !usedL.has(k));
  }
  return usd;
}

async function scoreChat(dir: string): Promise<Result | null> {
  const read = <T>(f: string): T | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;
    } catch {
      return null;
    }
  };
  const cps = read<Checkpoints>("checkpoints.json");
  const labels = read<Labels>("labels.json");
  if (!cps || !labels) {
    console.error(`${dir}: needs checkpoints.json and labels.json`);
    return null;
  }
  const file = path.join(dir, "settle.md");
  const old = fs.existsSync(file)
    ? readMarks(fs.readFileSync(file, "utf8"))
    : new Map();
  const used = new Set<string>();
  const markOf = (k: string): Mark | undefined => {
    used.add(k);
    return old.get(k)?.mark;
  };

  const score = emptyScore();
  const pairFile = path.join(dir, "pairs.json");
  const pairCache =
    read<Record<string, { map: string; label: number }[]>>("pairs.json") ?? {};
  let pairUsd = 0;
  const body: string[] = [];
  const matched: string[] = [];
  const unlabelled: number[] = [];
  let lines = 0;
  let marked = 0;
  let scored = 0;
  for (const cp of cps.checkpoints) {
    const lab = labels.checkpoints.find((l) => l.turn === cp.turn);
    if (!lab) {
      unlabelled.push(cp.turn);
      continue;
    }
    scored++;
    const m = matchLists(cp.items, cp.lists, asListed(lab.lists));
    pairUsd += await refine(m, cp.turn, pairCache);
    body.push(`## Turn ${cp.turn}`, "");
    if (lab.cut) body.push(`_${lab.cut}_`, "");
    const pairs: string[] = [];
    // what waits on you is in open too: a line settled under waiting is
    // settled for open as well, so it is shown once with boxes
    const asked = new Set<string>();
    for (const n of LIST_NAMES) {
      const lm = m[n];
      const own = (k: string) =>
        n === "open" && asked.has(k.replace(".open.", ".waiting."))
          ? k.replace(".open.", ".waiting.")
          : k;
      const mapKeys = lm.mapOnly.map((i) =>
        own(`t${cp.turn}.${n}.map.${i.id}`),
      );
      const labelKeys = lm.labelOnly.map((l) => own(labelKey(cp.turn, n, l)));
      if (n === "waiting")
        for (const k of [...mapKeys, ...labelKeys]) asked.add(k);
      const mapMarks = mapKeys.map(markOf);
      const labelMarks = labelKeys.map(markOf);
      const c = count(lm, mapMarks, labelMarks);
      add(score[n].before, c.before);
      add(score[n].after, c.after);
      const disagree = lm.mapOnly.length + lm.labelOnly.length;
      const line = (k: string, mark: Mark | undefined, text: string) => {
        if (n === "open" && k.includes(".waiting."))
          return body.push(`- as under waiting · ${text}`);
        lines++;
        if (mark) marked++;
        body.push(`${boxes(mark)} · ${text} <!-- k:${k} -->`);
      };
      body.push(
        `### ${n} · ${lm.pairs.length} matched, ${lm.mapOnly.length} map only, ${lm.labelOnly.length} label only`,
        "",
      );
      lm.mapOnly.forEach((i, x) =>
        line(mapKeys[x]!, mapMarks[x], `map: ${mapText(i)} · label: —`),
      );
      lm.labelOnly.forEach((l, x) =>
        line(labelKeys[x]!, labelMarks[x], `map: — · label: ${labelText(l)}`),
      );
      if (!disagree) body.push("Nothing to settle.");
      body.push("");
      for (const p of lm.pairs)
        pairs.push(
          `- ${n}: map ${mapText(p.item)} = label ${labelText(p.label)}`,
        );
    }
    if (pairs.length)
      matched.push(
        `<details><summary>Turn ${cp.turn} · ${pairs.length} matched</summary>`,
        "",
        ...pairs,
        "",
        "</details>",
        "",
      );
  }

  // marks whose line is gone (the labels or the map changed) are kept, so a
  // later run that brings the line back brings its mark back too
  const stale = [...old].filter(([k]) => !used.has(k)).map(([, v]) => v.line);

  const out = [
    `# Settle: ${cps.conv}`,
    "",
    `\`${cps.file}\` · ${cps.turns} turns · extractor ${cps.model || "default"} · labels ${labels.labeller}`,
    "",
    "Tick one box on each line. **map right**: the map has it right and the label is wrong. **label right**: the label is right and the map is wrong. **both wrong**: neither has it right (on a map-only line, the map's item is wrong and something real is missing). Unmarked lines count as label right. Run `node eval/extract-score.ts` again to rescore; your marks are kept.",
    "",
    `Settled ${marked} of ${lines} lines.${unlabelled.length ? ` Not labelled yet: turn ${unlabelled.join(", ")}.` : ""}`,
    "",
    ...scoreTable(score),
    "",
    `Gate (waiting, after settling): ${passes(score.waiting.after) ? "passes" : "fails"}.`,
    "",
    ...body,
    "## Matched",
    "",
    ...(matched.length ? matched : ["None.", ""]),
    ...(stale.length
      ? [
          "## Marks no longer matched",
          "",
          "These lines are gone from the comparison; their marks are kept here.",
          "",
          ...stale,
          "",
        ]
      : []),
  ];
  fs.writeFileSync(file, out.join("\n"));
  fs.writeFileSync(pairFile, JSON.stringify(pairCache));
  if (pairUsd)
    console.error(
      `${cps.conv.slice(0, 8)}: paired by meaning for $${pairUsd.toFixed(3)}`,
    );
  return {
    conv: cps.conv,
    checkpoints: scored,
    score,
    lines,
    marked,
    model: cps.model,
    labeller: labels.labeller,
  };
}

const pair = (
  c: { before: Counts; after: Counts },
  f: (c: Counts) => number | null,
) => `${pct(f(c.before))} → ${pct(f(c.after))}`;

function summary(results: Result[]): string[] {
  const all: Result = {
    conv: "All",
    checkpoints: 0,
    score: emptyScore(),
    lines: 0,
    marked: 0,
    model: "",
    labeller: "",
  };
  for (const r of results) {
    all.checkpoints += r.checkpoints;
    all.lines += r.lines;
    all.marked += r.marked;
    for (const n of LIST_NAMES) {
      add(all.score[n].before, r.score[n].before);
      add(all.score[n].after, r.score[n].after);
    }
  }
  const rows = [
    "| Chat | Checkpoints | Waiting recall | Waiting precision | Open R / P | Decided R / P | Taken R / P | Settled | Gate |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of [...results, all]) {
    const s = r.score;
    const rp = (n: ListName) =>
      `${pct(recall(s[n].after))} / ${pct(precision(s[n].after))}`;
    const name = r === all ? "**All**" : r.conv.slice(0, 8);
    rows.push(
      `| ${name} | ${r.checkpoints} | ${pair(s.waiting, recall)} | ${pair(s.waiting, precision)} | ${rp("open")} | ${rp("decided")} | ${rp("taken")} | ${r.marked}/${r.lines} | ${passes(s.waiting.after) ? "pass" : "fail"} |`,
    );
  }
  return rows;
}

async function main(args: string[]) {
  const dirs = args.length
    ? args
    : fs.existsSync(ROOT)
      ? fs
          .readdirSync(ROOT)
          .map((d) => path.join(ROOT, d))
          .filter((d) => fs.existsSync(path.join(d, "labels.json")))
      : [];
  const results: Result[] = [];
  for (const d of dirs) {
    const r = await scoreChat(d);
    if (r) results.push(r);
  }
  if (!results.length) {
    console.error("nothing to score");
    process.exit(1);
  }
  const models = [...new Set(results.map((r) => r.model || "default"))].join(
    ", ",
  );
  const labellers = [...new Set(results.map((r) => r.labeller))].join(", ");
  const table = summary(results);
  const head = `## ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${results.length} chats · extractor ${models} · labels ${labellers}`;
  const note =
    "Waiting is shown before → after settling; the other lists after. Gate: waiting recall ≥ 80% and precision ≥ 90% after settling.";
  console.log([head, "", note, "", ...table].join("\n"));
  for (const d of dirs) console.log(`settle: ${path.join(d, "settle.md")}`);
  fs.mkdirSync(ROOT, { recursive: true });
  const sumFile = path.join(ROOT, "summary.md");
  const prefix = fs.existsSync(sumFile) ? "\n" : "# Extractor eval\n\n";
  fs.appendFileSync(
    sumFile,
    `${prefix}${[head, "", note, "", ...table].join("\n")}\n`,
  );
}

if (import.meta.main) await main(process.argv.slice(2));
