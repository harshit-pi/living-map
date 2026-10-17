// Reading the model's reply: the readable caption, and the ops in the map block.

import type { Raw } from "./types.ts";

export const visiblePart = (text: string): string => text.split("```map")[0];

export const hasMapBlock = (text: string): boolean => text.includes("```map");

const CONTROL: Record<string, string> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

// Scans the map block's JSON for balanced {...} objects inside the ops array,
// respecting strings, so a half-written op is never applied. The block ends at
// the array's closing bracket, not at the first ``` (an explanation may hold a
// fenced code example inside a string). Raw line breaks and tabs inside strings,
// which JSON does not allow, are escaped rather than losing the op.
function scan(text: string): { ops: Raw[]; broken: number } {
  const ops: Raw[] = [];
  let broken = 0;
  const at = text.indexOf("```map");
  if (at < 0) return { ops, broken };
  const body = text.slice(at + 6);
  // The block is {"ops":[...]}, a bare array, or bare op objects one per line.
  // Only skip a leading "[" at the block's start: a "[" inside an op (a list in
  // its spec) is not the ops array.
  const head =
    body.match(/^[^{[]*(?:\{[^[]*?"ops"\s*:\s*)?\[/) ?? body.match(/^[^{[]*/);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let op = "";
  for (let i = head ? head[0].length : 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      op += !esc && CONTROL[ch] ? CONTROL[ch] : ch;
      continue;
    }
    if (depth > 0) op += ch;
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) op = "{";
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          ops.push(JSON.parse(op));
        } catch {
          broken++; // a malformed op is skipped; the rest still apply
        }
        op = "";
      }
    } else if (depth === 0 && (ch === "]" || body.startsWith("```", i))) break;
  }
  return { ops, broken };
}

// The op objects complete so far in a streaming reply, in order.
export const completeOps = (text: string): Raw[] => scan(text).ops;

// How many ops in a finished reply could not be read.
export const unreadableOps = (text: string): number => scan(text).broken;
