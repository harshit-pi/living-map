import type { LedgerItem } from "../../shared/ledger.ts";

// How a box looks: every box is white with the same thin border, and one
// colour means something: amber, for what waits on you. Everything else says
// its state with a small glyph (a green ◆ for decided, a green ● for an
// option taken) and grey text once it is done, settled or dropped.
export type Look = {
  box: string;
  title: string;
  glyph: string;
  mark: string; // the glyph's colour
  tag: string;
};

const PLAIN = "border border-line bg-surface";
const DONE = "text-muted";

export function lookOf(i: LedgerItem): Look {
  const dropped = i.state === "dropped" || i.state === "struck";
  if (dropped)
    return {
      box: PLAIN,
      title: `${DONE} line-through`,
      glyph: "–",
      mark: DONE,
      tag: i.state,
    };
  if (i.waiting)
    return {
      box: "border border-warning bg-warning-soft",
      title: "text-warning-strong",
      glyph: i.type === "ask" ? "⚑" : i.type === "task" ? "☐" : "?",
      mark: "text-warning-strong",
      tag: "on you",
    };
  switch (i.type) {
    case "topic":
      return {
        box: PLAIN,
        title:
          i.state === "done"
            ? `font-semibold ${DONE}`
            : "font-semibold text-ink",
        glyph: "",
        mark: DONE,
        tag: i.state === "done" ? "settled" : i.state,
      };
    case "question":
      return i.open
        ? {
            box: `${PLAIN} rounded-[20px]`,
            title: "text-ink",
            glyph: "?",
            mark: "text-muted",
            tag: i.owner === "claude" ? "Claude's to find out" : "open",
          }
        : {
            box: `${PLAIN} rounded-[20px]`,
            title: DONE,
            glyph: "?",
            mark: DONE,
            tag: i.state,
          };
    case "option":
      return i.state === "taken"
        ? {
            box: PLAIN,
            title: "text-ink",
            glyph: "●",
            mark: "text-success",
            tag: "taken",
          }
        : {
            box: PLAIN,
            title: "text-body",
            glyph: "○",
            mark: "text-muted",
            tag: "offered",
          };
    case "decision":
      return i.state === "reopened"
        ? {
            box: PLAIN,
            title: "text-ink",
            glyph: "◆",
            mark: "text-warning-strong",
            tag: "reopened",
          }
        : {
            box: PLAIN,
            title: "text-ink",
            glyph: "◆",
            mark: "text-success",
            tag: "decided",
          };
    case "task":
      return i.state === "doing"
        ? {
            box: PLAIN,
            title: "text-ink",
            glyph: "◐",
            mark: "text-primary",
            tag: i.owner === "claude" ? "Claude is on it" : "doing",
          }
        : i.state === "done"
          ? { box: PLAIN, title: DONE, glyph: "☑", mark: DONE, tag: "done" }
          : {
              box: PLAIN,
              title: "text-ink",
              glyph: "☐",
              mark: "text-muted",
              tag: i.owner === "you" ? "yours to do" : "to do",
            };
    case "ask":
      return { box: PLAIN, title: DONE, glyph: "⚑", mark: DONE, tag: i.state };
    case "assumption":
      return i.state === "confirmed"
        ? {
            box: PLAIN,
            title: DONE,
            glyph: "~",
            mark: DONE,
            tag: "confirmed",
          }
        : {
            box: PLAIN,
            title: "text-ink",
            glyph: "~",
            mark: "text-muted",
            tag: "assumed",
          };
    default:
      return {
        box: PLAIN,
        title: "text-body",
        glyph: "•",
        mark: "text-muted",
        tag: "finding",
      };
  }
}
