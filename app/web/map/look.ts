import type { LedgerItem } from "../../shared/ledger.ts";

export type Look = { box: string; title: string; glyph: string; tag: string };

// One look per state, never colour alone: a glyph, a word, and colour.
export function lookOf(i: LedgerItem): Look {
  const dropped = i.state === "dropped" || i.state === "struck";
  if (dropped)
    return {
      box: "border border-dashed border-line bg-panel",
      title: "text-muted line-through",
      glyph: "–",
      tag: i.state,
    };
  if (i.waiting)
    return {
      box: "border-2 border-warning bg-warning-soft",
      title: "text-warning-strong",
      glyph: i.type === "ask" ? "⚑" : "?",
      tag: "on you",
    };
  switch (i.type) {
    case "topic":
      return {
        box:
          i.state === "active"
            ? "border-2 border-primary bg-surface"
            : i.state === "open"
              ? "border-2 border-warning-line bg-surface"
              : "border-2 border-line-strong bg-panel",
        title: "font-semibold text-ink",
        glyph: "",
        tag: i.state === "done" ? "settled" : i.state,
      };
    case "question":
      return i.open
        ? {
            box: "rounded-[20px] border border-warning bg-surface",
            title: "text-ink",
            glyph: "?",
            tag: i.owner === "claude" ? "Claude's to find out" : "open",
          }
        : {
            box: "rounded-[20px] border border-line bg-surface",
            title: "text-body",
            glyph: "?",
            tag: i.state,
          };
    case "option":
      return i.state === "taken"
        ? {
            box: "border-2 border-success bg-success-soft",
            title: "text-success-strong",
            glyph: "●",
            tag: "taken",
          }
        : {
            box: "border border-dashed border-line-strong bg-surface",
            title: "text-ink",
            glyph: "○",
            tag: "offered",
          };
    case "decision":
      return i.state === "reopened"
        ? {
            box: "border-2 border-warning bg-surface",
            title: "font-semibold text-ink",
            glyph: "◆",
            tag: "reopened",
          }
        : {
            box: "border-2 border-success bg-success-soft",
            title: "font-semibold text-success-strong",
            glyph: "◆",
            tag: "decided",
          };
    case "task":
      return i.state === "doing"
        ? {
            box: "border border-primary bg-primary-soft",
            title: "text-primary-strong",
            glyph: "◐",
            tag: i.owner === "claude" ? "Claude is on it" : "doing",
          }
        : i.state === "done"
          ? {
              box: "border border-line bg-surface",
              title: "text-muted",
              glyph: "☑",
              tag: "done",
            }
          : {
              box: "border border-warning-line bg-surface",
              title: "text-ink",
              glyph: "☐",
              tag: i.owner === "you" ? "yours to do" : "to do",
            };
    case "ask":
      return {
        box: "border border-line bg-surface",
        title: "text-muted",
        glyph: "⚑",
        tag: i.state,
      };
    case "assumption":
      return i.state === "confirmed"
        ? {
            box: "border border-dashed border-success bg-surface",
            title: "text-body",
            glyph: "~",
            tag: "confirmed",
          }
        : {
            box: "border border-dashed border-warning bg-surface",
            title: "text-ink",
            glyph: "~",
            tag: "assumed",
          };
    default:
      return {
        box: "border border-line bg-surface",
        title: "text-body",
        glyph: "•",
        tag: "finding",
      };
  }
}
