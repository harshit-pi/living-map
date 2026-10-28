// A handover of each chat, kept on disk and current: rewritten whenever its
// map changes (a turn filed, something you did on the map), so a session
// that dies halfway still leaves one, with no end-of-session step to run.
// Fixed sections a new session, or you, can read in a minute: what waits on
// you, the next steps, what is still open, and what was decided, when and
// why. One file per chat, and one per project folder holding the chat most
// recently changed there, so a line in CLAUDE.md can point at a path that
// doesn't change from chat to chat.

import fs from "node:fs";
import path from "node:path";

import type { Conv, State } from "./db.ts";
import { isDecided } from "./outline.ts";
import type { LedgerItem, LedgerView } from "../shared/ledger.ts";

// the date in your time zone: a decision made this evening is dated today
const day = (ms: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

const turnOf = (i: LedgerItem) => i.src[0] ?? 0;
const byTurn = (a: LedgerItem, b: LedgerItem) => turnOf(a) - turnOf(b);

// a project folder as a file name, the way Claude Code names its own
// (/Users/me/work -> -Users-me-work)
export const folderName = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

export function handoverPaths(home: string, conv: Conv) {
  const dir = path.join(home, "handover");
  return {
    chat: path.join(dir, `${conv.root}.md`),
    project: conv.cwd
      ? path.join(dir, "projects", `${folderName(conv.cwd)}.md`)
      : null,
  };
}

// The handover itself. `s` gives each decision's date (when it was filed).
export function handoverText(v: LedgerView, s: State): string {
  const items = v.items.filter((i) => i.type !== "topic");
  const byId = new Map(v.items.map((i) => [i.id, i]));
  const when = (i: LedgerItem) => day(s.meta.get(i.id)?.filedAt ?? 0);
  const at = (i: LedgerItem) => `turn ${turnOf(i)}`;

  const waiting = items.filter((i) => i.waiting).sort(byTurn);
  const check = items.filter((i) => !i.waiting && i.unconfirmed).sort(byTurn);
  const next = items
    .filter((i) => !i.waiting && i.open && i.type === "task")
    .sort(byTurn);
  const open = items
    .filter((i) => !i.waiting && i.open && i.type !== "task")
    .sort(byTurn);
  // a taken option whose question a decision already answers is the same
  // choice twice: the decision, with its reason, stands for both
  const settledBy = new Set(
    items
      .filter((i) => i.type === "decision" && isDecided(i))
      .flatMap((i) =>
        i.links.filter((l) => l.rel === "answers").map((l) => l.to),
      ),
  );
  // when it was decided: the latest turn it came up in, not when it was offered
  const last = (i: LedgerItem) => i.src.at(-1) ?? 0;
  const decided = items
    .filter(
      (i) =>
        isDecided(i) &&
        !(i.type === "option" && i.parent && settledBy.has(i.parent)),
    )
    .sort((a, b) => last(a) - last(b));
  const forQuestion = (i: LedgerItem) => {
    const q = i.type === "option" && i.parent ? byId.get(i.parent) : undefined;
    return q?.type === "question" ? ` (for: ${q.title})` : "";
  };

  const holds = (i: LedgerItem) => {
    const up = i.links
      .filter((l) => l.rel === "blocks")
      .map((l) => byId.get(l.to)?.title)
      .filter(Boolean);
    return up.length ? `; holds up: ${up.join("; ")}` : "";
  };
  const whose = (i: LedgerItem) =>
    i.owner === "claude" ? "Claude" : i.owner === "you" ? "you" : "";

  const out = [
    `# Handover: ${v.title || "your chat"}`,
    "",
    `Kept current by Living Map: rewritten whenever this chat's map changes. Filed up to turn ${v.read} of ${v.turns}. Chat \`${v.conv}\`${s.conv.cwd ? ` in \`${s.conv.cwd}\`` : ""}.`,
    "",
    `## Waiting on you (${waiting.length})`,
    ...(waiting.length
      ? waiting.map((i) => `- ${i.title} (${at(i)}${holds(i)})`)
      : ["Nothing waits on you."]),
  ];
  if (check.length)
    out.push(
      "",
      `## Closed by the map, to check (${check.length})`,
      ...check.map(
        (i) =>
          `- ${i.title}: marked ${i.unconfirmed!.to} at turn ${i.unconfirmed!.turn}, with nothing in the chat that says so`,
      ),
    );
  out.push(
    "",
    `## Next steps (${next.length})`,
    ...(v.strip.doing ? [`Claude is on: ${v.strip.doing}`] : []),
    ...(next.length
      ? next.map(
          (i) =>
            `- ${i.title} (${[whose(i), i.state, at(i)].filter(Boolean).join(", ")})`,
        )
      : ["No tasks are open."]),
    "",
    `## Still open (${open.length})`,
    ...(open.length
      ? open.map(
          (i) =>
            `- ${i.title} (${[i.type, whose(i) && `${whose(i)} to find out`, at(i)].filter(Boolean).join(", ")})`,
        )
      : ["Nothing else is open."]),
    "",
    `## Decided (${decided.length})`,
    ...(decided.length
      ? decided.map((i) => {
          const why = i.body ? `: ${i.body.replace(/\s*\n\s*/g, " ")}` : "";
          return `- ${i.title}${forQuestion(i)}${why} (${[when(i), `turn ${last(i)}`].filter(Boolean).join(", ")})`;
        })
      : ["Nothing has been decided yet."]),
  );
  return `${out.join("\n")}\n`;
}

// what each file last held, so a push that changed nothing writes nothing
const written = new Map<string, string>();

function put(file: string, text: string) {
  if (written.get(file) === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // whole or not at all: a reader never sees half a file
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
  written.set(file, text);
}

// Writes the chat's handover, and its folder's: that one also lists the
// other chats with a map in the same folder, newest first.
export function writeHandover(
  home: string,
  s: State,
  v: LedgerView,
  chats: Conv[],
) {
  const text = handoverText(v, s);
  const p = handoverPaths(home, s.conv);
  put(p.chat, text);
  if (!p.project) return;
  const others = chats
    .filter((c) => c.cwd === s.conv.cwd && c.root !== s.conv.root)
    .slice(0, 5)
    .map((c) => `- ${c.title || c.root}: ${handoverPaths(home, c).chat}`);
  put(
    p.project,
    `${text}${others.length ? `\n## Other chats in this folder\n${others.join("\n")}\n` : ""}`,
  );
}
