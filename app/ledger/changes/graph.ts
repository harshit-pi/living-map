// Extractors for the what-changed view: one file's contents → the structural
// facts a diff compares. Pure: the caller supplies contents, the repo's file
// list and its path aliases, so the same code reads a snapshot, a transcript
// reconstruction or a test fixture.
//
// Version 2 reads TypeScript/JavaScript, Go and Python imports, package.json,
// go.mod, requirements files, pyproject.toml and docker-compose files. Every
// other kind is "unreadable", which is what keeps "No structural change"
// honest: it may only be said when every changed file is of a kind listed
// here.

import { builtinModules } from "node:module";
import { posix } from "node:path";

import {
  type Alias,
  type Context,
  depFact,
  type Fact,
  type FileKind,
  groupOf,
  moduleFacts,
  type Target,
} from "./facts.ts";
import {
  goHunkFacts,
  goModFacts,
  goModHunkFacts,
  goSourceFacts,
} from "./go.ts";
import { pyprojectFacts, pySourceFacts, requirementsFacts } from "./python.ts";

export type {
  Alias,
  Context,
  Fact,
  FileKind,
  GoModule,
  Kind,
  Target,
} from "./facts.ts";
export { groupOf, groupOfDir } from "./facts.ts";
export { goImports, goModInfo, resolveGo } from "./go.ts";
export { pyImports, resolvePy } from "./python.ts";

export type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const COMPOSE = /^(?:docker-)?compose(?:[.-][\w.-]+)?\.ya?ml$/;
const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts"];
const BUILTINS = new Set(builtinModules);
const REQUIREMENTS = /^requirements(?:[.-][\w.-]+)?\.txt$/;

export function fileKind(rel: string): FileKind | null {
  const base = posix.basename(rel);
  if (base === "package.json") return "manifest";
  if (COMPOSE.test(base)) return "compose";
  if (SOURCE.test(base) && !base.endsWith(".d.ts")) return "source";
  if (base === "go.mod") return "gomod";
  if (base.endsWith(".go")) return "go";
  if (base.endsWith(".py")) return "python";
  if (base === "pyproject.toml" || REQUIREMENTS.test(base)) return "pydeps";
  return null;
}

// ---------------------------------------------------------------- imports

// The code with comments removed, template literals and regex literals
// blanked, and every quoted string replaced by its index in `strings`, so an
// import written inside a string or a test fixture is never read as one.
function skeleton(src: string): { code: string; strings: string[] } {
  const strings: string[] = [];
  let code = "";
  let last = "";
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
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        s += src[j] ?? "";
        j++;
      }
      strings.push(s);
      code += `"${strings.length - 1}"`;
      last = '"';
      i = j + 1;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "$" && src[j + 1] === "{") {
          depth++;
          j += 2;
        } else if (src[j] === "}" && depth > 0) {
          depth--;
          j++;
        } else if (src[j] === "`" && depth === 0) break;
        else j++;
      }
      code += "``";
      last = "`";
      i = j + 1;
      continue;
    }
    if (c === "/" && regexAllowed(last, code)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      code += "/r/";
      last = "/";
      i = j;
      continue;
    }
    code += c;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return { code, strings };
}

function regexAllowed(last: string, code: string): boolean {
  if (last === "" || "(,=:[!&|?{};+-*%<>~^".includes(last)) return true;
  return /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)\s*$/.test(
    code,
  );
}

const IMPORT_PATTERNS = [
  /(?<![\w$.])import\s*(?:type\s+)?(?:[\w$*{}\s,]+?\s*from\s*)?"(\d+)"/g,
  /(?<![\w$.])export\s*(?:type\s+)?(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*"(\d+)"/g,
  /(?<![\w$.])require\s*\(\s*"(\d+)"\s*\)/g,
  /(?<![\w$.])import\s*\(\s*"(\d+)"\s*[,)]/g,
];

// Every module specifier the file imports: static imports, re-exports,
// require() and import() with a literal argument.
export function importSpecifiers(source: string): string[] {
  const { code, strings } = skeleton(source);
  const found = new Set<string>();
  for (const re of IMPORT_PATTERNS)
    for (const m of code.matchAll(re)) {
      const s = strings[Number(m[1])];
      if (s) found.add(s);
    }
  return [...found];
}

export function resolveSpecifier(
  fromRel: string,
  spec: string,
  ctx: Context = {},
): Target | null {
  const depth = ctx.depth ?? 2;
  const clean = spec.replace(/[?#].*$/, "");
  if (!clean || clean.includes("://")) return null;
  if (clean.startsWith(".") || clean.startsWith("/")) {
    const joined = clean.startsWith("/")
      ? posix.normalize(clean.slice(1))
      : posix.normalize(posix.join(posix.dirname(fromRel), clean));
    if (joined.startsWith("..")) return { group: "(outside the repo)" };
    return { group: groupOf(resolveFile(joined, ctx), depth) };
  }
  const alias = matchAlias(fromRel, clean, ctx.aliases ?? []);
  if (alias !== null)
    return { group: groupOf(resolveFile(posix.normalize(alias), ctx), depth) };
  if (clean.startsWith("@/") || clean.startsWith("~/"))
    return { group: `(alias ${clean.slice(0, 2)})` };
  if (clean.startsWith("node:"))
    return { pkg: `node:${clean.slice(5).split("/")[0]}`, low: true };
  const parts = clean.split("/");
  const name = clean.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (BUILTINS.has(name)) return { pkg: `node:${name}`, low: true };
  return { pkg: name };
}

// Which file an import names: itself, with an extension, or a directory's
// index. Unknown paths are taken as files, the common case in TypeScript.
function resolveFile(rel: string, ctx: Context): string {
  const exists = ctx.exists;
  if (!exists) return rel;
  if (exists(rel)) return rel;
  for (const ext of RESOLVE_EXT) if (exists(rel + ext)) return rel + ext;
  for (const ext of RESOLVE_EXT)
    if (exists(`${rel}/index${ext}`)) return `${rel}/index${ext}`;
  return rel;
}

function matchAlias(
  fromRel: string,
  spec: string,
  aliases: Alias[],
): string | null {
  let best: Alias | null = null;
  for (const a of aliases) {
    if (a.scope && !fromRel.startsWith(`${a.scope}/`)) continue;
    const hit = a.exact ? spec === a.prefix : spec.startsWith(a.prefix);
    if (hit && (!best || a.prefix.length > best.prefix.length)) best = a;
  }
  if (!best || !best.targets.length) return null;
  return best.exact
    ? best.targets[0]
    : best.targets[0] + spec.slice(best.prefix.length);
}

// tsconfig/jsconfig `compilerOptions.paths`, relative to the repo root.
// Tolerant of comments and trailing commas; a file it cannot read gives none.
export function parseAliases(text: string, configRel: string): Alias[] {
  let json: unknown;
  try {
    const { code, strings } = skeleton(text);
    json = JSON.parse(
      code
        .replace(/,(\s*[}\]])/g, "$1")
        .replace(/"(\d+)"/g, (_, i) => JSON.stringify(strings[Number(i)])),
    );
  } catch {
    return [];
  }
  const opts = (json as { compilerOptions?: Record<string, unknown> })
    ?.compilerOptions;
  const paths = opts?.paths;
  if (!paths || typeof paths !== "object") return [];
  const dir = posix.dirname(configRel) === "." ? "" : posix.dirname(configRel);
  const base = posix.join(
    dir || ".",
    typeof opts.baseUrl === "string" ? opts.baseUrl : ".",
  );
  const out: Alias[] = [];
  for (const [pattern, raw] of Object.entries(paths)) {
    const prefix = pattern.replace(/\*.*$/, "");
    // "*" alone would swallow every package name
    if (!Array.isArray(raw) || !prefix) continue;
    const targets = raw
      .filter((t): t is string => typeof t === "string")
      .map((t) => {
        const stem = t.replace(/\*.*$/, "");
        const p = posix.join(base, stem);
        if (p === "." || p === "./") return "";
        // "src/*" and a bare "*" both put the rest of the import after a "/"
        return t.includes("*") &&
          (!stem || stem.endsWith("/")) &&
          !p.endsWith("/")
          ? `${p}/`
          : p;
      });
    out.push({ scope: dir, prefix, exact: !pattern.includes("*"), targets });
  }
  return out;
}

export function sourceFacts(
  rel: string,
  source: string,
  ctx: Context = {},
): Fact[] {
  return moduleFacts(rel, targets(rel, source, ctx), ctx);
}

function targets(rel: string, source: string, ctx: Context): Target[] {
  return importSpecifiers(source)
    .map((spec) => resolveSpecifier(rel, spec, ctx))
    .filter((t): t is Target => t !== null);
}

// ---------------------------------------------------------------- package.json

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export function manifestFacts(rel: string, text: string): Fact[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const pkg = json as Record<string, unknown>;
  const facts: Fact[] = [];
  const each = (field: string, f: (name: string, v: string) => Fact) => {
    const o = pkg[field];
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    for (const [name, v] of Object.entries(o))
      if (typeof v === "string") facts.push(f(name, v));
  };
  for (const section of DEP_SECTIONS)
    each(section, (name, v) => depFact(rel, section, name, v));
  each("scripts", (name, v) => ({
    kind: "script",
    key: `${rel}#script#${name}`,
    text: `script "${name}" (${rel})`,
    value: v,
    file: rel,
  }));
  each("engines", (name, v) => ({
    kind: "engine",
    key: `${rel}#engine#${name}`,
    text: `engine ${name} (${rel})`,
    value: v,
    file: rel,
  }));
  return facts;
}

// ---------------------------------------------------------------- compose

// Drops a YAML comment: a "#" at the start or after whitespace, outside quotes.
function stripComment(line: string): string {
  let q = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1])))
      return line.slice(0, i);
  }
  return line;
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

function flowList(s: string): string[] | null {
  const m = s.trim().match(/^\[(.*)\]$/);
  if (!m) return null;
  return m[1]
    .split(",")
    .map(unquote)
    .filter((x) => x);
}

type Service = {
  name: string;
  image?: string;
  build?: string;
  ports: string[];
  dependsOn: string[];
};

// A tolerant, line-based reader for the parts of a compose file this version
// diffs: services, their image or build, published ports and depends_on.
// Anything it does not recognise is skipped rather than guessed.
export function composeFacts(rel: string, text: string): Fact[] | null {
  const lines = text
    .split(/\r?\n/)
    .map(stripComment)
    .map((l) => ({
      indent: (l.match(/^ */) ?? [""])[0].length,
      body: l.trim(),
    }))
    .filter((l) => l.body && l.body !== "---");
  const start = lines.findIndex(
    (l) => l.indent === 0 && /^services\s*:/.test(l.body),
  );
  if (start < 0) return [];
  if (!/^services\s*:\s*$/.test(lines[start].body)) return null;
  const services: Service[] = [];
  let svcIndent = -1;
  let keyIndent = -1;
  let blockIndent = -1;
  let cur: Service | null = null;
  let key = "";
  let longPort: Record<string, string> | null = null;
  const flushPort = () => {
    if (cur && longPort) cur.ports.push(longPortText(longPort));
    longPort = null;
  };
  for (const l of lines.slice(start + 1)) {
    if (l.indent === 0) break;
    if (svcIndent < 0) svcIndent = l.indent;
    if (l.indent < svcIndent) break;
    if (l.indent === svcIndent) {
      flushPort();
      const m = l.body.match(/^["']?([\w.-]+)["']?\s*:/);
      cur = m ? { name: m[1], ports: [], dependsOn: [] } : null;
      if (cur) services.push(cur);
      keyIndent = -1;
      key = "";
      continue;
    }
    if (!cur) continue;
    if (keyIndent < 0) keyIndent = l.indent;
    if (l.indent <= keyIndent) {
      flushPort();
      const m = l.body.match(/^([\w-]+)\s*:\s*(.*)$/);
      key = m ? m[1] : "";
      blockIndent = -1;
      const rest = m ? m[2] : "";
      if (key === "image" && rest) cur.image = unquote(rest);
      else if (key === "build" && rest) cur.build = unquote(rest);
      else if (key === "ports" && rest)
        cur.ports.push(...(flowList(rest) ?? []));
      else if (key === "depends_on" && rest)
        cur.dependsOn.push(...(flowList(rest) ?? []));
      continue;
    }
    if (blockIndent < 0) blockIndent = l.indent;
    if (key === "build") {
      const m = l.body.match(/^context\s*:\s*(.+)$/);
      if (m && l.indent === blockIndent) cur.build = unquote(m[1]);
    } else if (key === "ports") {
      if (l.body.startsWith("- ") || l.body === "-") {
        flushPort();
        const item = l.body.slice(1).trim();
        const kv = item.match(/^([\w-]+)\s*:\s*(.*)$/);
        if (kv) longPort = { [kv[1]]: unquote(kv[2]) };
        else if (item) cur.ports.push(unquote(item));
      } else if (longPort) {
        const kv = l.body.match(/^([\w-]+)\s*:\s*(.*)$/);
        if (kv) longPort[kv[1]] = unquote(kv[2]);
      }
    } else if (key === "depends_on" && l.indent === blockIndent) {
      if (l.body.startsWith("- ")) cur.dependsOn.push(unquote(l.body.slice(2)));
      else {
        const m = l.body.match(/^["']?([\w.-]+)["']?\s*:/);
        if (m) cur.dependsOn.push(m[1]);
      }
    }
  }
  flushPort();
  const facts: Fact[] = [];
  for (const s of services) {
    facts.push({
      kind: "service",
      key: `${rel}#service#${s.name}`,
      text: `service ${s.name} (${rel})`,
      value: s.image
        ? `image ${s.image}`
        : s.build
          ? `build ${s.build}`
          : undefined,
      file: rel,
    });
    for (const p of new Set(s.ports))
      facts.push({
        kind: "port",
        key: `${rel}#port#${s.name}#${p}`,
        text: `port ${p} published by ${s.name} (${rel})`,
        file: rel,
      });
    for (const d of new Set(s.dependsOn))
      facts.push({
        kind: "service",
        key: `${rel}#depends#${s.name}#${d}`,
        text: `${s.name} depends on ${d} (${rel})`,
        file: rel,
      });
  }
  return facts;
}

function longPortText(p: Record<string, string>): string {
  const host = p.host_ip ? `${p.host_ip}:` : "";
  const pub = p.published ? `${p.published}:` : "";
  const proto = p.protocol && p.protocol !== "tcp" ? `/${p.protocol}` : "";
  return `${host}${pub}${p.target ?? "?"}${proto}`;
}

// ---------------------------------------------------------------- dispatch

// The facts in one file, or null when its kind is unreadable or its contents
// could not be parsed (a package.json caught mid-edit).
export function extract(
  rel: string,
  content: string,
  ctx: Context = {},
): Fact[] | null {
  switch (fileKind(rel)) {
    case "source":
      return sourceFacts(rel, content, ctx);
    case "manifest":
      return manifestFacts(rel, content);
    case "compose":
      return composeFacts(rel, content);
    case "go":
      return goSourceFacts(rel, content, ctx);
    case "gomod":
      return goModFacts(rel, content);
    case "python":
      return pySourceFacts(rel, content, ctx);
    case "pydeps":
      return posix.basename(rel) === "pyproject.toml"
        ? pyprojectFacts(rel, content)
        : requirementsFacts(rel, content);
    default:
      return null;
  }
}

// ---------------------------------------------------------------- hunks only

const VERSION_LIKE =
  /^(?:[\^~<>=]*\s*v?\d|\*$|latest$|next$|workspace:|file:|link:|npm:|github:|git\+|https?:)/;

// When a file's full text is unknown, the facts on each side of its hunks:
// import edges for source files, dependency lines for manifests. The result
// can miss facts outside the hunks, so statements from it are marked
// partial. Compose and pyproject structure lives in context a hunk cuts off,
// so they give null.
export function hunkFacts(
  rel: string,
  hunks: Hunk[],
  ctx: Context = {},
): { before: Fact[]; after: Fact[] } | null {
  const kind = fileKind(rel);
  const read = HUNK_READERS[kind ?? ""];
  if (!read || posix.basename(rel) === "pyproject.toml") return null;
  const side = (keep: string) =>
    hunks.map((h) =>
      h.lines
        .filter((l) => l[0] === " " || l[0] === keep)
        .map((l) => l.slice(1))
        .join("\n"),
    );
  return {
    before: side("-").flatMap((t) => read(rel, t, ctx)),
    after: side("+").flatMap((t) => read(rel, t, ctx)),
  };
}

const HUNK_READERS: Record<
  string,
  (rel: string, text: string, ctx: Context) => Fact[]
> = {
  source: (rel, t, ctx) => moduleFacts(rel, targets(rel, t, ctx), ctx, false),
  manifest: (rel, t) => manifestLines(rel, t.split("\n")),
  go: goHunkFacts,
  gomod: (rel, t) => goModHunkFacts(rel, t),
  python: (rel, t, ctx) => pySourceFacts(rel, t, ctx, false),
  pydeps: (rel, t) => requirementsFacts(rel, t),
};

function manifestLines(rel: string, lines: string[]): Fact[] {
  const facts: Fact[] = [];
  let section = "";
  for (const l of lines) {
    const open = l.match(/"(\w*[dD]ependencies|scripts|engines)"\s*:\s*\{/);
    if (open) {
      section = open[1];
      continue;
    }
    if (/^\s*}/.test(l)) {
      section = "";
      continue;
    }
    const m = l.match(/^\s*"([^"]+)"\s*:\s*"([^"]*)"/);
    if (!m) continue;
    if (section === "scripts" || section === "engines") continue;
    if (section || VERSION_LIKE.test(m[2]))
      facts.push(depFact(rel, section || "dependencies?", m[1], m[2]));
  }
  return facts;
}

// ---------------------------------------------------------------- patches

// Applies unified-diff hunks (Claude Code's structuredPatch) to a text. A hunk
// whose context is not where it says is looked for further on; a hunk that is
// not there at all gives null rather than a wrong reconstruction.
export function applyHunks(text: string, hunks: Hunk[]): string | null {
  const src = text.split("\n");
  const out: string[] = [];
  let pos = 0;
  for (const h of [...hunks].sort((a, b) => a.oldStart - b.oldStart)) {
    const old = h.lines
      .filter((l) => l[0] === " " || l[0] === "-")
      .map((l) => l.slice(1));
    const want = h.oldLines === 0 ? h.oldStart : h.oldStart - 1;
    const at = findBlock(src, old, Math.max(pos, want), pos);
    if (at < 0) return null;
    out.push(...src.slice(pos, at));
    for (const l of h.lines)
      if (l[0] === " " || l[0] === "+") out.push(l.slice(1));
    pos = at + old.length;
  }
  out.push(...src.slice(pos));
  return out.join("\n");
}

function findBlock(
  src: string[],
  block: string[],
  hint: number,
  from: number,
): number {
  const fits = (at: number) =>
    at + block.length <= src.length && block.every((l, i) => src[at + i] === l);
  if (fits(hint)) return hint;
  for (let at = from; at + block.length <= src.length; at++)
    if (fits(at)) return at;
  return -1;
}

// The same hunks the other way round, to step a file back from a later
// version to an earlier one.
export function invertHunks(hunks: Hunk[]): Hunk[] {
  const flip: Record<string, string> = { "-": "+", "+": "-" };
  return hunks.map((h) => ({
    oldStart: h.newStart,
    oldLines: h.newLines,
    newStart: h.oldStart,
    newLines: h.oldLines,
    lines: h.lines.map((l) => (flip[l[0]] ?? l[0]) + l.slice(1)),
  }));
}

// Whether hunks describe a whole file appearing or going ("@@ -0,0 +1,n @@"
// and its reverse), which tells a Bash diff's missing side for free.
export function hunkShape(hunks: Hunk[]): "create" | "delete" | null {
  if (hunks.length !== 1) return null;
  const [h] = hunks;
  if (h.oldStart === 0 && h.oldLines === 0) return "create";
  if (h.newStart === 0 && h.newLines === 0) return "delete";
  return null;
}

// One side of hunks that cover a whole file, as that file's text.
export function hunkSide(hunks: Hunk[], side: "-" | "+"): string {
  return hunks
    .flatMap((h) => h.lines.filter((l) => l[0] === side || l[0] === " "))
    .map((l) => l.slice(1))
    .join("\n");
}
