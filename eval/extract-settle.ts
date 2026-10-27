// Settles the scorer's disagreements with a third reader: for every line of
// settle.md nobody has marked, Opus reads the turns from where the entry came
// up to the checkpoint and says whether it belongs in that list as of then.
// Its marks are written into settle.md like a person's (and kept by the
// scorer on reruns), each with "settled by Opus" and its reason, so a score
// after these marks is never mistaken for one a person checked.
// It calls the model (Opus): only when asked.
//
//   node eval/extract-settle.ts [<conv dir>...]   then: node eval/extract-score.ts

import fs from "node:fs";
import path from "node:path";

import { LABEL_SYSTEM, render } from "./extract-label.ts";
import {
  emptyTranscript,
  readMore,
  view,
  type Turn,
} from "../ledger/transcript.ts";
import { HOME } from "../server/config.ts";
import { claudeCode } from "../server/providers/claude-code.ts";

// $LIVING_MAP_HOME when set, like the server and the scorer, so two runs
// can each keep their own folder
const home = HOME;
const ROOT = path.join(home, "eval", "extract");
const provider = claudeCode({ home });

const LINE =
  /^- \[ \] map right {2}\[ \] label right {2}\[ \] both wrong · (.*) <!-- k:(t(\d+)\.(\w+)\.(map|label)\.[\w.-]+) -->$/;

type Entry = {
  key: string;
  line: string;
  checkpoint: number;
  list: string;
  side: "map" | "label";
  title: string;
  turns: number[];
  note: string;
};

function parse(md: string): Entry[] {
  const out: Entry[] = [];
  for (const line of md.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, body, key, cp, list, side] = m;
    const map = /map: "(.*?)" \(i\d+, t([\d, t]+)\)/.exec(body!);
    const label =
      /label: "(.*?)" \(t(\d+)(?:, for "(.*?)")?\)(?: — (.*))?/.exec(body!);
    const hit = side === "map" ? map : label;
    if (!hit) continue;
    out.push({
      key: key!,
      line,
      checkpoint: Number(cp),
      list: list!,
      side: side as "map" | "label",
      title: hit[1]!,
      turns: hit[2]!
        .split(/,\s*t?/)
        .map(Number)
        .filter((n) => n > 0),
      note:
        side === "label"
          ? [label?.[3], label?.[4]].filter(Boolean).join(" · ")
          : "",
    });
  }
  return out;
}

const SYSTEM = `${LABEL_SYSTEM}

You are now the referee between two readers of this conversation who disagree. You are given ENTRIES, each one reader's claim that something belongs in a list, and the conversation from shortly before the earliest entry up to the checkpoint turn. For each entry decide, as of the last turn shown and by the definitions above, whether it belongs in the list named: "yes", "no", or "unclear" when the turns honestly allow both. Give a reason in at most 20 words, quoting the turn that decides it when you can.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entry", "verdict", "why"],
        properties: {
          entry: { type: "integer" },
          verdict: { type: "string", enum: ["yes", "no", "unclear"] },
          why: { type: "string" },
        },
      },
    },
  },
};

async function turnsOf(file: string): Promise<Turn[]> {
  const t = emptyTranscript();
  await readMore(t, file);
  return view(t, Number.POSITIVE_INFINITY).turns;
}

// yes on a map-only line: the map found it; no: the label was right not to
// list it. On a label-only line the other way round.
const markFor = (e: Entry, v: string): "map" | "label" | null =>
  v === "unclear"
    ? null
    : (v === "yes") === (e.side === "map")
      ? "map"
      : "label";

const tick = (line: string, mark: "map" | "label", why: string) =>
  line
    .replace(
      mark === "map" ? "- [ ] map right" : "[ ] label right",
      mark === "map" ? "- [x] map right" : "[x] label right",
    )
    .replace(
      " <!-- k:",
      ` · settled by Opus: ${why.replace(/<!--|-->/g, "")} <!-- k:`,
    );

async function settle(dir: string) {
  const file = path.join(dir, "settle.md");
  const cps = path.join(dir, "checkpoints.json");
  if (!fs.existsSync(file) || !fs.existsSync(cps)) return { usd: 0, done: 0 };
  const { file: transcript } = JSON.parse(fs.readFileSync(cps, "utf8")) as {
    file: string;
  };
  const turns = await turnsOf(transcript);
  let md = fs.readFileSync(file, "utf8");
  const entries = parse(md);
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = `${e.checkpoint}|${e.list}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  let usd = 0;
  let done = 0;
  const log: unknown[] = [];
  for (const group of groups.values()) {
    const { checkpoint, list } = group[0]!;
    const from = Math.max(1, Math.min(...group.flatMap((e) => e.turns)) - 2);
    const { text } = render(
      turns.filter((t) => t.n >= from),
      checkpoint,
    );
    const message = [
      `LIST: ${list}`,
      `CHECKPOINT: turn ${checkpoint} (judge as of this turn)`,
      "",
      "ENTRIES:",
      ...group.map(
        (e, n) =>
          `${n}. "${e.title}" (turn ${e.turns.join(", ")})${e.note ? ` — ${e.note}` : ""}`,
      ),
      "",
      `THE CONVERSATION, turns ${from}–${checkpoint}:`,
      text,
    ].join("\n");
    const r = await provider.extract!({
      system: SYSTEM,
      message,
      schema: SCHEMA,
      model: "opus",
      effort: "medium",
      timeoutMs: 240_000,
    });
    usd += r.usage?.costUsd ?? 0;
    if (!r.ok) {
      console.error(
        `${path.basename(dir).slice(0, 8)} t${checkpoint} ${list}: ${r.error}`,
      );
      continue;
    }
    const verdicts = (
      r.value as { verdicts: { entry: number; verdict: string; why: string }[] }
    ).verdicts;
    for (const v of verdicts) {
      const e = group[v.entry];
      if (!e) continue;
      log.push({ key: e.key, verdict: v.verdict, why: v.why });
      const mark = markFor(e, v.verdict);
      if (!mark) continue;
      md = md.replace(e.line, tick(e.line, mark, v.why));
      done++;
    }
    fs.writeFileSync(file, md);
  }
  fs.writeFileSync(
    path.join(dir, "settle-opus.json"),
    JSON.stringify(log, null, 1),
  );
  console.log(
    `${path.basename(dir).slice(0, 8)}: ${done} of ${entries.length} lines settled by Opus, $${usd.toFixed(2)}`,
  );
  return { usd, done };
}

const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs
      .readdirSync(ROOT)
      .map((d) => path.join(ROOT, d))
      .filter((d) => fs.existsSync(path.join(d, "settle.md")));
let total = 0;
// a few chats at once; each chat's groups run in order so its file stays whole
let next = 0;
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (next < dirs.length) {
      const r = await settle(dirs[next++]!);
      total += r.usd;
    }
  }),
);
console.log(`total: $${total.toFixed(2)}`);
