// The map as text for the chat to read back (GET /api/outline): what matters
// now first (what waits on you, what is open, what was decided, what Claude
// is on), then the whole map with settled topics folded to one line. A
// lens (?lens=waiting|open|decided) gives one section alone, so "what's
// pending" costs the chat a few lines, not every item ever filed.

import type { LedgerItem, LedgerView } from "../shared/ledger.ts";

export const OUTLINE_LENSES = ["waiting", "open", "decided"] as const;
export type OutlineLens = (typeof OUTLINE_LENSES)[number];

export const outlineLens = (v: unknown): OutlineLens | undefined =>
  OUTLINE_LENSES.find((l) => l === v);

export const isDecided = (i: LedgerItem) =>
  (i.type === "decision" && i.state === "decided") ||
  (i.type === "option" && i.state === "taken");

const turnsText = (src: number[]) =>
  src.length === 1 ? `turn ${src[0]}` : `turns ${src.join(", ")}`;

const ownerOf = (i: LedgerItem) =>
  i.owner === "you" ? ", yours" : i.owner === "claude" ? ", Claude's" : "";

// the top-level topic an item sits in, by its parents
function topicOf(byId: Map<string, LedgerItem>, i: LedgerItem) {
  let cur: LedgerItem | undefined = i;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.type === "topic") return cur;
    seen.add(cur.id);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return undefined;
}

const byTurn = (a: LedgerItem, b: LedgerItem) =>
  (a.src[0] ?? 0) - (b.src[0] ?? 0) || a.order.localeCompare(b.order);

// one item as a list line: its id, kind, state, whose, and where it came up
function line(byId: Map<string, LedgerItem>, i: LedgerItem): string[] {
  const topic = topicOf(byId, i);
  const where = [turnsText(i.src), topic ? `in "${topic.title}"` : ""]
    .filter(Boolean)
    .join("; ");
  const out = [
    `- ${i.id} ${i.type} (${i.state}${ownerOf(i)}): ${i.title} (${where})`,
  ];
  if (i.body) out.push(`  ${i.body.replace(/\s*\n\s*/g, " ")}`);
  for (const l of i.links) {
    const to = byId.get(l.to);
    if (to) out.push(`  ${l.rel.replace(/-/g, " ")} ${to.id}: ${to.title}`);
  }
  return out;
}

function section(
  byId: Map<string, LedgerItem>,
  head: string,
  items: LedgerItem[],
  none: string,
): string[] {
  const out = [`### ${head} (${items.length})`];
  if (!items.length) out.push(none);
  for (const i of items) out.push(...line(byId, i));
  return out;
}

export function outline(v: LedgerView, lens?: OutlineLens): string {
  const items = v.items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const rest = items.filter((i) => i.type !== "topic");
  const waiting = rest.filter((i) => i.waiting).sort(byTurn);
  const open = rest.filter((i) => !i.waiting && i.open).sort(byTurn);
  const decided = rest.filter(isDecided).sort(byTurn);
  const sections: Record<OutlineLens, () => string[]> = {
    waiting: () =>
      section(byId, "Waiting on you", waiting, "Nothing waits on you."),
    open: () =>
      section(
        byId,
        "Open",
        open,
        waiting.length ? "Nothing else is open." : "Nothing is open.",
      ),
    decided: () =>
      section(byId, "Decided", decided, "Nothing has been decided yet."),
  };
  const title = v.title || "Your chat";
  const out = [`# ${title}: the map`];
  if (lens) {
    out.push(
      `Filed up to turn ${v.read} of ${v.turns}.`,
      "",
      ...sections[lens](),
    );
    return `${out.join("\n")}\n`;
  }
  out.push(
    `Filed up to turn ${v.read} of ${v.turns}. "Now" is what matters at this point; the whole map follows, settled topics folded to one line each. Ask with ?lens=waiting, open or decided for one section alone.`,
    "",
    "## Now",
    v.strip.doing
      ? `Claude is on: ${v.strip.doing}`
      : "Claude isn't on a task.",
    "",
    ...sections.waiting(),
    "",
    ...sections.open(),
    "",
    ...sections.decided(),
    "",
    "## The whole map",
  );
  const kids = new Map<string | null, LedgerItem[]>();
  for (const i of items) {
    const p = i.parent && byId.has(i.parent) ? i.parent : null;
    kids.set(p, [...(kids.get(p) ?? []), i]);
  }
  for (const list of kids.values())
    list.sort((a, b) => a.order.localeCompare(b.order));
  const under = (id: string): number =>
    (kids.get(id) ?? []).reduce((n, c) => n + 1 + under(c.id), 0);
  const seen = new Set<string>();
  const walk = (p: string | null, depth: number) => {
    for (const i of kids.get(p) ?? []) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      const head = depth === 0 ? "###" : "####";
      const whose = i.owner
        ? ` · ${i.owner === "you" ? "yours" : "Claude's"}`
        : "";
      if (i.type === "topic" && i.state === "done") {
        const n = under(i.id);
        out.push(
          "",
          `${head} ${i.id} · topic · done: ${i.title} (${n} item${n === 1 ? "" : "s"}, all settled; folded)`,
        );
        continue;
      }
      out.push(
        "",
        `${head} ${i.id} · ${i.type}${i.state ? ` · ${i.state}` : ""}${whose}: ${i.title}`,
      );
      if (p) out.push(`Under: ${p}`);
      if (i.body) out.push(i.body);
      if (i.quote)
        out.push(`> ${i.quote.replace(/\n/g, " ")} (${turnsText(i.src)})`);
      else if (i.src.length) out.push(`From ${turnsText(i.src)}.`);
      for (const l of i.links) {
        const to = byId.get(l.to);
        if (to) out.push(`${l.rel.replace(/-/g, " ")}: ${to.id} ${to.title}`);
      }
      walk(i.id, depth + 1);
    }
  };
  walk(null, 0);
  return `${out.join("\n")}\n`;
}
