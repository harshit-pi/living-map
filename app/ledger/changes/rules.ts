// Fixed rules from a graph diff to typed statements. Facts from every file
// fold by key (many files importing app/layer are one edge), so a statement
// says what changed in the system, and its evidence says which files and
// which tool calls changed it. No model is involved at this layer.

import type { Fact, Kind } from "./graph.ts";

export type Op = "added" | "removed" | "changed";

export type Evidence = {
  file: string;
  turn?: number;
  toolUseId?: string;
  tool?: string;
  // read from diff hunks only: facts outside the hunks were not seen
  partial?: boolean;
};

export type Statement = {
  op: Op;
  kind: Kind;
  key: string;
  text: string;
  from?: string;
  to?: string;
  // the files whose facts differ between the two graphs
  files: string[];
  evidence: Evidence[];
};

const KIND_ORDER: Kind[] = [
  "module",
  "import-edge",
  "dependency",
  "engine",
  "script",
  "service",
  "port",
];

type Folded = { fact: Fact; byFile: Map<string, string | undefined> };

function fold(facts: Fact[]): Map<string, Folded> {
  const out = new Map<string, Folded>();
  for (const f of facts) {
    const k = `${f.kind}\0${f.key}`;
    let e = out.get(k);
    if (!e) out.set(k, (e = { fact: f, byFile: new Map() }));
    e.byFile.set(f.file, f.value);
  }
  return out;
}

// The value a folded fact has: one value, or every distinct one when files
// disagree (two manifests pinning different versions are keyed apart anyway).
const valueOf = (e: Folded) =>
  [...new Set(e.byFile.values())].filter((v) => v !== undefined).join(" | ") ||
  undefined;

export function diffGraphs(before: Fact[], after: Fact[]): Statement[] {
  const b = fold(before);
  const a = fold(after);
  const out: Statement[] = [];
  for (const [k, e] of a) {
    const old = b.get(k);
    if (!old) {
      out.push(statement("added", e.fact, undefined, valueOf(e), e.byFile));
      continue;
    }
    const from = valueOf(old);
    const to = valueOf(e);
    if (from !== to) {
      const files = new Set<string>();
      for (const f of new Set([...old.byFile.keys(), ...e.byFile.keys()]))
        if (old.byFile.get(f) !== e.byFile.get(f)) files.add(f);
      out.push(statement("changed", e.fact, from, to, files));
    }
  }
  for (const [k, e] of b)
    if (!a.has(k))
      out.push(statement("removed", e.fact, valueOf(e), undefined, e.byFile));
  return out.sort(
    (x, y) =>
      KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) ||
      x.op.localeCompare(y.op) ||
      x.key.localeCompare(y.key),
  );
}

function statement(
  op: Op,
  fact: Fact,
  from: string | undefined,
  to: string | undefined,
  files: Iterable<string> | Map<string, unknown>,
): Statement {
  const list = [...(files instanceof Map ? files.keys() : files)].sort();
  return {
    op,
    kind: fact.kind,
    key: fact.key,
    text: describe(op, fact.text, from, to),
    from,
    to,
    files: list,
    evidence: [],
  };
}

const short = (v: string) => {
  const m = maskSecrets(v.replace(/\s+/g, " ").trim());
  return m.length > 80 ? `${m.slice(0, 77)}…` : m;
};

function describe(op: Op, text: string, from?: string, to?: string): string {
  if (op === "changed")
    return `changed ${text}: ${short(from ?? "(none)")} → ${short(to ?? "(none)")}`;
  if (op === "added" && to) return `added ${text}: ${short(to)}`;
  return `${op} ${text}`;
}

// Evidence for statements from one tool call: each file it names, tagged
// with the call that changed it.
export function attach(
  statements: Statement[],
  ev: Omit<Evidence, "file">,
): Statement[] {
  return statements.map((s) => ({
    ...s,
    evidence: [...s.evidence, ...s.files.map((file) => ({ ...ev, file }))],
  }));
}

// A net statement (session start → end) borrows the evidence of the per-call
// statements about the same thing; one nothing explains keeps its files.
export function explain(net: Statement[], calls: Statement[]): Statement[] {
  const by = new Map<string, Evidence[]>();
  for (const c of calls) {
    const k = `${c.kind}\0${c.key}`;
    by.set(k, [...(by.get(k) ?? []), ...c.evidence]);
  }
  return net.map((s) => {
    const ev = by.get(`${s.kind}\0${s.key}`);
    return {
      ...s,
      evidence: ev?.length ? dedupe(ev) : s.files.map((file) => ({ file })),
    };
  });
}

function dedupe(ev: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return ev.filter((e) => {
    const k = `${e.file}\0${e.toolUseId ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type ChangedFile = {
  path: string;
  // an extractor reads its kind
  readable: boolean;
  // its contents before and after were rebuilt in full
  reconstructed: boolean;
};

export type Verdict = { allowed: boolean; reason: string };

// "No structural change" is a claim about every changed file, so it holds
// only when no rule fired, every file is of a kind an extractor reads, each
// was rebuilt in full, and no write went unseen.
export function noStructuralChange(
  statements: Statement[],
  files: ChangedFile[],
  unseenWrites = 0,
): Verdict {
  if (statements.length)
    return {
      allowed: false,
      reason: `${statements.length} structural statement${statements.length === 1 ? "" : "s"}`,
    };
  const reasons: string[] = [];
  const unreadable = files.filter((f) => !f.readable);
  if (unreadable.length)
    reasons.push(
      `${unreadable.length} changed file${unreadable.length === 1 ? " is" : "s are"} of kinds no extractor reads (${extensions(unreadable)})`,
    );
  const missing = files.filter((f) => f.readable && !f.reconstructed);
  if (missing.length)
    reasons.push(
      `${missing.length} readable file${missing.length === 1 ? "" : "s"} could not be rebuilt in full`,
    );
  if (unseenWrites)
    reasons.push(
      `${unseenWrites} Bash command${unseenWrites === 1 ? "" : "s"} may have written files without a diff`,
    );
  if (reasons.length) return { allowed: false, reason: reasons.join("; ") };
  return {
    allowed: true,
    reason: files.length
      ? `No structural change: ${files.length} file${files.length === 1 ? "" : "s"} edited`
      : "No structural change: no files changed",
  };
}

export function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : base;
}

function extensions(files: ChangedFile[]): string {
  const n = new Map<string, number>();
  for (const f of files)
    n.set(extensionOf(f.path), (n.get(extensionOf(f.path)) ?? 0) + 1);
  return [...n]
    .sort((a, b) => b[1] - a[1])
    .map(([e, c]) => (c > 1 ? `${e} ×${c}` : e))
    .join(", ");
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{12,}/g, "***"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "***"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "***"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, "***"],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/g, "***"],
  [/(\/\/[^/\s:@]+:)[^@\s/]+@/g, "$1***@"],
  [
    /\b((?:api[_-]?key|key|token|secret|password|passwd|pwd|auth|credentials?)\s*[=:]\s*)(["']?)[^\s"'&;]+/gi,
    "$1$2***",
  ],
  // a long run of letters and digits, as keys and tokens are
  [/\b(?=[\w+-]*\d)(?=[\w+-]*[A-Za-z])[\w+-]{32,}={0,2}/g, "***"],
];

// Masks anything in a line that looks like a secret value, so a statement
// can quote a script or an image without leaking a token in it.
export function maskSecrets(s: string): string {
  return SECRET_PATTERNS.reduce((t, [re, to]) => t.replace(re, to), s);
}
