// The transcript adapter over your largest Claude Code transcripts: what it
// finds in each and how long a full read takes. Local only; it reads
// ~/.claude/projects and writes nothing.
//
//   node eval/transcripts.ts [N]     the N largest (default 5)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emptyTranscript, readMore, view } from "../ledger/transcript.ts";

const n = Number(process.argv[2]) || 5;
const root = path.join(os.homedir(), ".claude", "projects");

const files = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    fs
      .readdirSync(path.join(root, d.name))
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(root, d.name, f)),
  )
  .map((f) => ({ f, stat: fs.statSync(f) }))
  .sort((a, b) => b.stat.size - a.stat.size)
  .slice(0, n);

const cols = [
  "file",
  "MB",
  "entries",
  "dup uuids",
  "bad",
  "compactions",
  "prompts (typed+queued+cmd)",
  "turns sealed",
  "abandoned",
  "patches",
  "read s",
];
const rows: string[][] = [];

for (const { f, stat } of files) {
  const t = emptyTranscript();
  const start = performance.now();
  await readMore(t, f);
  const v = view(t, Date.now() - stat.mtimeMs);
  const secs = (performance.now() - start) / 1000;
  const via = (k: string) => v.turns.filter((tn) => tn.via === k).length;
  rows.push([
    path.basename(f).slice(0, 8),
    (stat.size / 1e6).toFixed(0),
    String(t.entries.length),
    String(t.duplicates),
    String(t.bad),
    String(v.compactions),
    `${v.turns.length} (${via("typed")}+${via("queued")}+${via("command")})`,
    `${v.sealed}/${v.turns.length}`,
    String(v.abandoned.length),
    String(v.changes.length),
    secs.toFixed(2),
  ]);
}

const width = cols.map((c, i) =>
  Math.max(c.length, ...rows.map((r) => r[i].length)),
);
const line = (r: string[]) =>
  `| ${r.map((c, i) => c.padEnd(width[i])).join(" | ")} |`;
console.log(line(cols));
console.log(`|${width.map((w) => "-".repeat(w + 2)).join("|")}|`);
for (const r of rows) console.log(line(r));
