import type { MapNode, Purpose } from "../../shared/model.ts";

// One look per state, never colour alone: border style, a word, and colour.
export function lookOf(n: MapNode, purpose: Purpose) {
  const learn = purpose === "learn";
  const hint = n.kind === "fact" && /^hint\b/i.test(n.title);
  if (n.dropped || n.status === "dropped")
    return {
      box: "border border-dashed border-line-strong bg-panel opacity-50",
      title: "text-muted line-through",
      tag: "set aside",
      tagCls: "text-faint",
    };
  if (n.revealed)
    return {
      box: "border border-hint bg-hint-soft",
      title: "text-hint-strong",
      tag: "answer shown",
      tagCls: "text-hint-strong",
    };
  if (n.kind === "question" && n.status === "open")
    return {
      box: "border-2 border-warning bg-warning-soft",
      title: "text-warning-strong",
      tag: learn ? "to figure out" : "open question",
      tagCls: "text-warning-strong",
    };
  if (n.kind === "question")
    return {
      box: "border border-success bg-success-soft",
      title: "text-success-strong",
      tag: learn ? "✓ you got it" : "decided",
      tagCls: "text-success-strong",
    };
  if (n.status === "chosen")
    return {
      box: "border-2 border-success bg-success-soft",
      title: "text-success-strong",
      tag: learn ? "✓ trying this" : "✓ your choice",
      tagCls: "text-success-strong",
    };
  if (n.kind === "option")
    return {
      box: "border border-dashed border-line-strong bg-surface",
      title: "text-ink",
      tag: learn ? "approach" : "option",
      tagCls: "text-muted",
    };
  if (hint)
    return {
      box: "border border-hint-line bg-hint-soft",
      title: "text-hint-strong",
      tag: "hint",
      tagCls: "text-hint-strong",
    };
  return {
    box: "border border-line bg-panel",
    title: "text-ink",
    tag: learn ? "concept" : "fact",
    tagCls: "text-muted",
  };
}
