import type { Lens } from "./lens.ts";
import { PENDING } from "./pending.ts";
import type { LedgerItem } from "../../shared/ledger.ts";

// How a box looks: every box is white with the same thin border, and one
// colour means something: amber, for what waits on you. Everything else says
// its state with a small glyph (a green ◆ for decided, an option taken
// included, since taking one is how it was decided; a ✓ for a task or ask
// that is done) and grey text once it
// is done, settled or dropped. A settled topic is a faint grey fill with no
// border (the node gives it a box back while something inside still waits
// or is open), so the topics still in play are the boxes you see first, and
// lines still meet a shape at both ends.
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
  // turns on their way to the map: a dashed outline, nothing filed yet
  if (i.id === PENDING)
    return {
      box: "border border-dashed border-line-strong bg-canvas",
      title: "text-muted italic",
      glyph: "◐",
      mark: "text-primary",
      tag: "the model is reading these turns",
    };
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
        // the border stays, transparent, so a settled box keeps its size
        box:
          i.state === "done"
            ? "border border-transparent bg-panel/50 hover:border-line"
            : PLAIN,
        title:
          i.state === "done" ? `font-medium ${DONE}` : "font-semibold text-ink",
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
            glyph: "◆",
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
          ? { box: PLAIN, title: DONE, glyph: "✓", mark: DONE, tag: "done" }
          : {
              box: PLAIN,
              title: "text-ink",
              glyph: "☐",
              mark: "text-muted",
              tag: i.owner === "you" ? "yours to do" : "to do",
            };
    // the flag stays for asks still waiting on you; one that is done is ticked
    case "ask":
      return { box: PLAIN, title: DONE, glyph: "✓", mark: DONE, tag: i.state };
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

// A lens colours what it lights, in the colour of its button: the map stays
// quiet until you ask, then one click shows exactly those boxes.
export const LENS_LOOK: Record<
  Lens,
  { box: string; mark: string; text: string; on: string }
> = {
  waiting: {
    box: "border border-warning bg-warning-soft",
    mark: "text-warning-strong",
    text: "text-warning-strong",
    on: "border-warning bg-warning-soft font-medium text-warning-strong",
  },
  open: {
    box: "border border-open bg-open-soft",
    mark: "text-open",
    text: "text-open-strong",
    on: "border-open bg-open-soft font-medium text-open-strong",
  },
  decided: {
    box: "border border-success bg-success-soft",
    mark: "text-success",
    text: "text-success-strong",
    on: "border-success bg-success-soft font-medium text-success-strong",
  },
  changed: {
    box: "border border-hint bg-hint-soft",
    mark: "text-hint",
    text: "text-hint-strong",
    on: "border-hint bg-hint-soft font-medium text-hint-strong",
  },
};
