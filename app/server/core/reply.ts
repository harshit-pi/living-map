// Reading the model's reply: the readable caption, and the ops in the map block.

import type { Raw } from "./types.ts";

export const visiblePart = (text: string): string => text.split("```map")[0];

export const hasMapBlock = (text: string): boolean => text.includes("```map");

// The op objects complete so far in a streaming reply, in order. Scans the map
// block's JSON for balanced {...} objects inside the ops array, respecting
// strings, so a half-written op is never applied.
export function completeOps(text: string): Raw[] {
  const at = text.indexOf("```map");
  if (at < 0) return [];
  let body = text.slice(at + 6);
  const end = body.indexOf("```");
  if (end >= 0) body = body.slice(0, end);
  const arr = body.indexOf("[");
  if (arr < 0) return [];
  const out: Raw[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = arr + 1; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(body.slice(start, i + 1)));
        } catch {
          // a malformed op is skipped; the rest still apply
        }
        start = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}
