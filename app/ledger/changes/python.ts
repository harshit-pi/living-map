// Python: import edges from .py files, and dependencies from requirements
// files and pyproject.toml. An import resolves to a module or package in the
// repo when one exists, searched from the importing file's directory upward
// (Lambda handlers import their siblings), from src/ and from the roots the
// caller names (a Lambda layer's python/ directory); otherwise it is a
// top-level module node, low signal when it is the standard library.

import { posix } from "node:path";

import {
  type Context,
  depFact,
  engineFact,
  type Fact,
  groupOf,
  groupOfDir,
  moduleFacts,
  type Target,
} from "./facts.ts";

// Python 3.12's standard library, top-level names only.
const STDLIB = new Set(
  `__future__ _thread abc aifc argparse array ast asynchat asyncio asyncore atexit
  audioop base64 bdb binascii bisect builtins bz2 calendar cgi cgitb chunk cmath cmd
  code codecs codeop collections colorsys compileall concurrent configparser
  contextlib contextvars copy copyreg cProfile crypt csv ctypes curses dataclasses
  datetime dbm decimal difflib dis doctest email encodings ensurepip enum errno
  faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt
  getpass gettext glob graphlib grp gzip hashlib heapq hmac html http imaplib imghdr
  importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale
  logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msvcrt
  multiprocessing netrc nis nntplib numbers operator optparse os ossaudiodev pathlib
  pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath
  pprint profile pstats pty pwd py_compile pyclbr pydoc queue quopri random re
  readline reprlib resource rlcompleter runpy sched secrets select selectors shelve
  shlex shutil signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3 ssl
  stat statistics string stringprep struct subprocess sunau symtable sys sysconfig
  syslog tabnanny tarfile telnetlib tempfile termios textwrap threading time timeit
  tkinter token tokenize tomllib trace traceback tracemalloc tty turtle types typing
  unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser winreg
  winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo`.split(
    /\s+/,
  ),
);

// The code with comments removed and string contents blanked (triple-quoted
// ones included), keeping line breaks, so a docstring's "import x" is never
// read as an import.
function skeleton(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < n && !src.startsWith(q, j) && (triple || src[j] !== "\n")) {
        if (src[j] === "\\") j++;
        else if (src[j] === "\n") out += "\n";
        j++;
      }
      out += `${q}${q}`;
      i = j + q.length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export type PyImport = { dots: number; module: string };

// Every import in a Python file: `import a.b`, `import a as b, c`,
// `from a.b import c` and relative `from . import x`, `from ..pkg import y`.
export function pyImports(source: string): PyImport[] {
  const found = new Map<string, PyImport>();
  const add = (dots: number, module: string) => {
    if (module === "__future__") return;
    found.set(`${dots}:${module}`, { dots, module });
  };
  for (const line of skeleton(source).split("\n"))
    for (const stmt of line.split(";")) {
      const from = stmt.match(/^\s*from\s+(\.*)\s*([\w.]*)\s+import\b/);
      if (from) {
        if (from[1] || from[2]) add(from[1].length, from[2]);
        continue;
      }
      const imp = stmt.match(/^\s*import\s+(.+)$/);
      if (!imp) continue;
      for (const part of imp[1].split(",")) {
        const m = part.trim().match(/^([\w.]+)/);
        if (m) add(0, m[1]);
      }
    }
  return [...found.values()];
}

export function resolvePy(
  fromRel: string,
  imp: PyImport,
  ctx: Context,
): Target {
  const depth = ctx.depth ?? 2;
  const exists = ctx.exists ?? (() => false);
  const isDir = ctx.isDir ?? (() => false);
  const at = (p: string): Target | null => {
    if (exists(`${p}.py`)) return { group: groupOf(`${p}.py`, depth) };
    if (isDir(p)) return { group: groupOfDir(p, depth) };
    return null;
  };
  const path = imp.module.replace(/\./g, "/");
  if (imp.dots) {
    let base = posix.dirname(fromRel);
    for (let i = 1; i < imp.dots; i++) base = posix.dirname(base);
    const p = posix.normalize(path ? posix.join(base, path) : base);
    if (p.startsWith("..")) return { group: "(outside the repo)" };
    return at(p) ?? { group: groupOfDir(p, depth) };
  }
  const roots: string[] = [];
  for (let d = posix.dirname(fromRel); ; d = posix.dirname(d)) {
    roots.push(d === "." ? "" : d);
    if (d === "." || d === "/" || d === "") break;
  }
  if (isDir("src")) roots.push("src");
  roots.push(...(ctx.pyRoots ?? []));
  const parts = path.split("/");
  for (const root of roots)
    for (let k = parts.length; k > 0; k--) {
      const hit = at(posix.join(root || ".", ...parts.slice(0, k)));
      if (hit) return hit;
    }
  return STDLIB.has(parts[0])
    ? { pkg: `py:${parts[0]}`, low: true }
    : { pkg: parts[0] };
}

export function pySourceFacts(
  rel: string,
  source: string,
  ctx: Context = {},
  withModule = true,
): Fact[] {
  return moduleFacts(
    rel,
    pyImports(source).map((i) => resolvePy(rel, i, ctx)),
    ctx,
    withModule,
  );
}

// ---------------------------------------------------------------- dependencies

const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

// A PEP 508 requirement ("requests[socks]>=2.31; python_version>'3.8'") as
// its name and the rest, or null for a line that is not one.
function requirement(s: string): { name: string; spec: string } | null {
  const m = s
    .trim()
    .match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/);
  if (!m) return null;
  const spec = m[2].replace(/^@\s*/, "@ ").trim();
  return { name: normalize(m[1]), spec: spec || "any" };
}

export function requirementsFacts(rel: string, text: string): Fact[] {
  const facts: Fact[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/(^|\s)#.*$/, "").trim();
    // options (-r, -e, --index-url) and bare URLs name no package here
    if (!l || l.startsWith("-") || /^[a-z+]+:\/\//i.test(l)) continue;
    const r = requirement(l);
    if (r) facts.push(depFact(rel, "requirements", r.name, r.spec));
  }
  return facts;
}

function stripTomlComment(line: string): string {
  let q = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

// Open brackets and braces outside strings, to join a multi-line array.
function depthOf(s: string): number {
  let d = 0;
  let q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{") d++;
    else if (c === "]" || c === "}") d--;
  }
  return d;
}

const strings = (s: string) =>
  [...s.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);

const POETRY = /^tool\.poetry\.(?:group\.([\w-]+)\.)?(dev-)?dependencies$/;

// A tolerant pyproject.toml reader for the tables that list dependencies:
// [project] (and its optional-dependencies), [dependency-groups] and
// Poetry's dependency tables; requires-python and Poetry's python are engines.
export function pyprojectFacts(rel: string, text: string): Fact[] {
  const facts: Fact[] = [];
  const lines = text.split(/\r?\n/);
  let table = "";
  for (let i = 0; i < lines.length; i++) {
    const l = stripTomlComment(lines[i]).trim();
    const header = l.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (header) {
      table = header[1].replace(/["']/g, "");
      continue;
    }
    const kv = l.match(/^["']?([\w.-]+)["']?\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2];
    while (depthOf(value) > 0 && i + 1 < lines.length)
      value += `\n${stripTomlComment(lines[++i])}`;
    const reqs = (section: string) => {
      for (const s of strings(value)) {
        const r = requirement(s);
        if (r) facts.push(depFact(rel, section, r.name, r.spec));
      }
    };
    const poetry = table.match(POETRY);
    if (table === "project" && key === "dependencies") reqs("project");
    else if (table === "project" && key === "requires-python")
      facts.push(engineFact(rel, "python", strings(value)[0] ?? value));
    else if (table === "project.optional-dependencies") reqs(`optional ${key}`);
    else if (table === "dependency-groups") reqs(`group ${key}`);
    else if (poetry) {
      const section = poetry[1]
        ? `poetry ${poetry[1]}`
        : poetry[2]
          ? "poetry dev"
          : "poetry";
      const version = value.trim().startsWith("{")
        ? (value.match(/version\s*=\s*["']([^"']*)["']/)?.[1] ??
          (value
            .match(/\b(path|git|url)\s*=\s*["']([^"']*)["']/)
            ?.slice(1)
            .join(" ") ||
            "any"))
        : (strings(value)[0] ?? value.trim());
      if (key === "python") facts.push(engineFact(rel, "python", version));
      else facts.push(depFact(rel, section, normalize(key), version));
    }
  }
  return facts;
}
