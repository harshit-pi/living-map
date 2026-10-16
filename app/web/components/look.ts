import type { MapNode, Purpose } from "../../shared/model.ts";

// One look per state, never colour alone: border style, a word, and colour.
export function lookOf(n: MapNode, purpose: Purpose) {
  const learn = purpose === "learn";
  const hint = n.kind === "fact" && /^hint\b/i.test(n.title);
  if (n.dropped || n.status === "dropped")
    return {
      box: "border border-dashed border-cl-line2 bg-cl-panel opacity-50",
      title: "text-cl-mute line-through",
      tag: "set aside",
      tagCls: "text-cl-faint",
    };
  if (n.revealed)
    return {
      box: "border border-violet-400 bg-violet-50",
      title: "text-violet-950",
      tag: "answer shown",
      tagCls: "text-violet-700",
    };
  if (n.kind === "question" && n.status === "open")
    return {
      box: "border-2 border-amber-500 bg-amber-50",
      title: "text-amber-950",
      tag: learn ? "to figure out" : "open question",
      tagCls: "text-amber-700",
    };
  if (n.kind === "question")
    return {
      box: "border border-teal-600 bg-teal-50",
      title: "text-teal-950",
      tag: learn ? "✓ you got it" : "decided",
      tagCls: "text-teal-700",
    };
  if (n.status === "chosen")
    return {
      box: "border-2 border-teal-600 bg-teal-50",
      title: "text-teal-950",
      tag: learn ? "✓ trying this" : "✓ your choice",
      tagCls: "text-teal-700",
    };
  if (n.kind === "option")
    return {
      box: "border border-dashed border-cl-line2 bg-white",
      title: "text-cl-ink",
      tag: learn ? "approach" : "option",
      tagCls: "text-cl-mute",
    };
  if (hint)
    return {
      box: "border border-violet-300 bg-violet-50",
      title: "text-violet-950",
      tag: "hint",
      tagCls: "text-violet-700",
    };
  return {
    box: "border border-cl-line bg-cl-panel",
    title: "text-cl-ink",
    tag: learn ? "concept" : "fact",
    tagCls: "text-cl-mute",
  };
}
