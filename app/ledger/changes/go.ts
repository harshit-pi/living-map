// Go: import edges from .go files, and dependencies from go.mod. Imports of
// the repo's own modules resolve through each go.mod's `module` path to the
// directory they name; the standard library is a low-signal node, and an
// external import is named by the module it belongs to.

import { posix } from "node:path";

import {
  type Context,
  depFact,
  engineFact,
  type Fact,
  groupOfDir,
  moduleFacts,
  type Target,
} from "./facts.ts";

// Comments removed and every string replaced by its index in `strings`, so
// an import path inside a comment or a raw string is never read as one.
function skeleton(src: string): { code: string; strings: string[] } {
  const strings: string[] = [];
  let code = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      code += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== c && (c === "`" || src[j] !== "\n")) {
        if (src[j] === "\\" && c !== "`") j++;
        s += src[j] ?? "";
        j++;
      }
      strings.push(c === '"' ? s : "");
      code += `"${strings.length - 1}"`;
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  return { code, strings };
}

// Every import path in a Go file: `import "x"`, `import alias "x"`, dot and
// blank imports, and import blocks.
export function goImports(source: string): string[] {
  const { code, strings } = skeleton(source);
  const found = new Set<string>();
  const add = (i: string) => {
    if (strings[Number(i)]) found.add(strings[Number(i)]);
  };
  for (const m of code.matchAll(/\bimport\s*\(([^)]*)\)/g))
    for (const s of m[1].matchAll(/"(\d+)"/g)) add(s[1]);
  for (const m of code.matchAll(/\bimport\s+(?:[\w.]+\s+)?"(\d+)"/g)) add(m[1]);
  return [...found];
}

// Import paths in a fragment of a file (a diff hunk), where the `import (`
// line may be cut off: a line holding only an optional name and a path.
function importLines(text: string): string[] {
  const found = new Set(goImports(text));
  for (const l of text.split("\n")) {
    const m = l.match(/^\s*(?:[\w.]+\s+)?"([^"\s]+)"\s*$/);
    if (m) found.add(m[1]);
  }
  return [...found];
}

const HOSTS_WITH_OWNER = /^(?:github\.com|gitlab\.com|bitbucket\.org)$/;

export function resolveGo(fromRel: string, spec: string, ctx: Context): Target {
  const depth = ctx.depth ?? 2;
  const fromDir = posix.dirname(fromRel);
  const inside = (dir: string) =>
    !dir || fromDir === dir || fromDir.startsWith(`${dir}/`);
  const local = (ctx.goModules ?? [])
    .filter((m) => spec === m.path || spec.startsWith(`${m.path}/`))
    // the longest module path wins; the nearest go.mod breaks a tie
    .sort(
      (a, b) =>
        b.path.length - a.path.length ||
        Number(inside(b.dir)) - Number(inside(a.dir)) ||
        b.dir.length - a.dir.length,
    )[0];
  if (local) {
    const rest = spec.slice(local.path.length + 1);
    const dir = posix.normalize(posix.join(local.dir || ".", rest || "."));
    return { group: groupOfDir(dir, depth) };
  }
  const parts = spec.split("/");
  // a standard library path has no dot in its first element
  if (!parts[0].includes(".")) return { pkg: `go:${parts[0]}`, low: true };
  const req = (ctx.goRequires ?? [])
    .filter((r) => spec === r || spec.startsWith(`${r}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (req) return { pkg: req };
  return {
    pkg: parts.slice(0, HOSTS_WITH_OWNER.test(parts[0]) ? 3 : 2).join("/"),
  };
}

export function goSourceFacts(
  rel: string,
  source: string,
  ctx: Context = {},
): Fact[] {
  return moduleFacts(
    rel,
    goImports(source).map((s) => resolveGo(rel, s, ctx)),
    ctx,
  );
}

export function goHunkFacts(rel: string, text: string, ctx: Context): Fact[] {
  return moduleFacts(
    rel,
    importLines(text).map((s) => resolveGo(rel, s, ctx)),
    ctx,
    false,
  );
}

// ---------------------------------------------------------------- go.mod

export type GoMod = { module?: string; requires: string[] };

// go.mod's directives, line by line: module, go, toolchain, and require and
// replace in their single-line and block forms.
function readGoMod(rel: string, lines: string[], inBlock = "") {
  const facts: Fact[] = [];
  const info: GoMod = { requires: [] };
  let block = inBlock;
  for (const raw of lines) {
    const indirect = /\/\/\s*indirect\b/.test(raw);
    const l = raw.replace(/\/\/.*$/, "").trim();
    if (!l) continue;
    if (l === ")") {
      block = inBlock;
      continue;
    }
    const open = l.match(/^(require|replace|exclude|retract|tool)\s*\($/);
    if (open) {
      block = open[1];
      continue;
    }
    const head = l.match(/^(module|go|toolchain|require|replace)\s+(.+)$/);
    const rest = head ? head[2] : l;
    // a hunk's guess of "require" is wrong for a replace block's lines
    const verb =
      (head ? head[1] : block) === "require" && rest.includes("=>")
        ? "replace"
        : head
          ? head[1]
          : block;
    if (verb === "module") info.module = rest.replace(/^"|"$/g, "");
    else if (verb === "go") facts.push(engineFact(rel, "go", rest));
    else if (verb === "toolchain")
      facts.push(engineFact(rel, "toolchain", rest));
    else if (verb === "require") {
      const m = rest.match(/^"?([^\s"]+)"?\s+(\S+)/);
      if (!m) continue;
      info.requires.push(m[1]);
      facts.push(
        indirect
          ? {
              ...depFact(rel, "require", m[1], `${m[2]} (indirect)`),
              low: "indirect",
            }
          : depFact(rel, "require", m[1], m[2]),
      );
    } else if (verb === "replace") {
      const m = rest.match(/^(\S+)(?:\s+\S+)?\s*=>\s*(.+)$/);
      if (m) facts.push(depFact(rel, "replace", m[1], `=> ${m[2].trim()}`));
    }
  }
  return { facts, info };
}

export function goModFacts(rel: string, text: string): Fact[] {
  return readGoMod(rel, text.split(/\r?\n/)).facts;
}

export function goModInfo(text: string): GoMod {
  return readGoMod("", text.split(/\r?\n/)).info;
}

// A hunk of go.mod: a bare `path version` line sits in a require block whose
// opening line the hunk may not show.
export function goModHunkFacts(rel: string, text: string): Fact[] {
  return readGoMod(rel, text.split("\n"), "require").facts;
}
