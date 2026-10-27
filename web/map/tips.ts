import type { LedgerItem } from "../../shared/ledger.ts";

// One-time tips: the first time a kind of box is on screen, a line beside it
// says what it is. Each shows once per browser, one at a time.
export type TipId =
  | "waiting"
  | "lenses"
  | "topic"
  | "task"
  | "question"
  | "option"
  | "assumption"
  | "decision"
  | "settled"
  | "card";

export const TIPS: Record<TipId, string> = {
  waiting:
    "Amber means it waits on you. Click it to answer, or to tick it off.",
  lenses:
    "Each lens lights its boxes on the map, and its colour matches theirs.",
  topic:
    "A topic: one part of the chat. The arrow folds it, and a clay edge marks the one Claude is on.",
  task: "A task: ☐ still to do, ◐ Claude is on it, ✓ done.",
  question:
    "An open question. “Claude's to find out” means Claude owes the answer.",
  option: "An option Claude offered. ● marks the one taken.",
  assumption: "Something Claude assumed. Click it to confirm or strike it.",
  decision:
    "A decision, under the topic where it was made. Green ◆ is in force; amber ◆ was reopened.",
  settled: "Grey is settled; struck through was dropped.",
  card: "Ask about this opens a side chat that knows this chat. Nothing reaches the chat until you apply it.",
};

// the order tips come in when several kinds are on screen: what waits on
// you first, then how to light it, then the rest
const ORDER: TipId[] = [
  "waiting",
  "lenses",
  "topic",
  "task",
  "question",
  "option",
  "assumption",
  "decision",
  "settled",
];

// the tip a box on the map stands for, if any
export function kindOf(i: LedgerItem): TipId | null {
  if (i.waiting) return "waiting";
  if (i.state === "dropped" || i.state === "struck") return "settled";
  switch (i.type) {
    case "topic":
      return i.state === "done" ? "settled" : "topic";
    case "task":
      return i.state === "done" ? "settled" : "task";
    case "question":
      return i.open ? "question" : "settled";
    case "option":
      return "option";
    case "assumption":
      return i.state === "confirmed" ? "settled" : "assumption";
    case "ask":
      return "settled";
    case "decision":
      return "decision";
    default:
      return null;
  }
}

// The next tip to show: `onScreen` holds, in map order, the items whose
// boxes are fully on screen; `lenses` is whether the lens row is.
export function nextTip(
  onScreen: LedgerItem[],
  lenses: boolean,
  seen: ReadonlySet<string>,
): { tip: TipId; item: string | null } | null {
  const first = new Map<TipId, string>();
  for (const i of onScreen) {
    const k = kindOf(i);
    if (k && !first.has(k)) first.set(k, i.id);
  }
  for (const tip of ORDER) {
    if (seen.has(tip)) continue;
    if (tip === "lenses") {
      if (lenses) return { tip, item: null };
    } else if (first.has(tip)) return { tip, item: first.get(tip)! };
  }
  return null;
}
