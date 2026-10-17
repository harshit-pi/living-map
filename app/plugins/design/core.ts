// Design's pure logic, no I/O: the rough load check, edits to the design,
// cleaning the model's ops, and the outline the model reads each move.

import {
  isKind,
  isSide,
  KINDS,
  type Brief,
  type Carries,
  type Comp,
  type KindId,
  type Load,
  type Reference,
  type Review,
  type ReviewPoint,
  type Wire,
} from "./shared.ts";
import { list, safeId, str, type Raw } from "../../server/core/types.ts";

export type DesignState = {
  brief: Brief | null;
  comps: Comp[];
  wires: Wire[];
  review: Review | null;
  // the design Claude judges against; never sent to the browser until revealed
  reference: Reference | null;
  revealed: boolean;
  // what you removed last, newest last, for Undo: a part with its wires, or
  // a wire on its own
  removed?: { comp?: Comp; wires: Wire[] }[];
};

export const newState = (): DesignState => ({
  brief: null,
  comps: [],
  wires: [],
  review: null,
  reference: null,
  revealed: false,
  removed: [],
});

const num = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};
const carriesOf = (v: unknown): Carries =>
  v === "read" || v === "write" ? v : "both";

// ---------------------------------------------------------------- load

const HIT = 1 - KINDS.cache.passRead; // share of reads a cache answers
const NO_CACHE = { fronted: new Set<string>(), aside: false };

// The percent of the brief's reads and writes each client makes. Shares set
// on a client count as given (scaled down if they add up to more than all of
// it); clients without one split the rest evenly. When every client has one,
// they are taken as proportions of the whole.
export function clientShares(
  comps: Comp[],
): Record<string, { reads: number; writes: number }> {
  const clients = comps.filter((c) => KINDS[c.kind].source);
  const split = (key: "readShare" | "writeShare") => {
    const sum = clients.reduce((a, c) => a + (c[key] ?? 0), 0);
    const rest = clients.filter((c) => c[key] === undefined).length;
    return (c: Comp): number => {
      if (!rest) return sum > 0 ? (c[key]! * 100) / sum : 100 / clients.length;
      if (c[key] === undefined) return Math.max(0, 100 - sum) / rest;
      return sum > 100 ? (c[key] * 100) / sum : c[key];
    };
  };
  const reads = split("readShare");
  const writes = split("writeShare");
  return Object.fromEntries(
    clients.map((c) => [c.id, { reads: reads(c), writes: writes(c) }]),
  );
}

export function capacity(c: Comp): { read: number; write: number } {
  const k = KINDS[c.kind];
  if (k.store) {
    // replicas add reads; only shards add writes
    const shards = k.shards ? c.shards : 1;
    return { read: k.capRead * c.count * shards, write: k.capWrite * shards };
  }
  return { read: k.capRead * c.count, write: k.capWrite * c.count };
}

// Rough peak traffic through each component, from the brief's reads and
// writes per second. Rules of thumb, not a benchmark: good enough to show
// which part falls over first and why.
export function loadCheck(s: {
  brief: Brief | null;
  comps: Comp[];
  wires: Wire[];
}): Record<string, Load> {
  const byId = new Map(s.comps.map((c) => [c.id, c]));
  const wires = s.wires.filter(
    (w) => byId.has(w.from) && byId.has(w.to) && w.from !== w.to,
  );
  const r = new Map<string, number>();
  const w = new Map<string, number>();
  const asyncFrom = new Set<string>();
  // each client makes its own share of the brief's traffic, wherever it is wired
  const shares = clientShares(s.comps);
  for (const [id, sh] of Object.entries(shares)) {
    r.set(id, ((s.brief?.reads ?? 0) * sh.reads) / 100);
    w.set(id, ((s.brief?.writes ?? 0) * sh.writes) / 100);
  }

  // topological order. A cycle is broken where traffic enters it: the part
  // already fed by one placed before it goes next, and the wire back into it
  // is not followed, so every part in the loop still gets its load.
  const indeg = new Map(s.comps.map((c) => [c.id, 0]));
  for (const x of wires) indeg.set(x.to, (indeg.get(x.to) ?? 0) + 1);
  const order: string[] = [];
  const placed = new Set<string>();
  const ready = s.comps.filter((c) => indeg.get(c.id) === 0).map((c) => c.id);
  while (order.length < s.comps.length) {
    if (!ready.length) {
      const rest = s.comps.filter((c) => !placed.has(c.id));
      const fed = rest.find((c) =>
        wires.some((x) => x.to === c.id && placed.has(x.from)),
      );
      ready.push((fed ?? rest[0]).id);
    }
    const id = ready.shift()!;
    if (placed.has(id)) continue;
    placed.add(id);
    order.push(id);
    for (const x of wires)
      if (x.from === id && !placed.has(x.to)) {
        indeg.set(x.to, indeg.get(x.to)! - 1);
        if (indeg.get(x.to) === 0) ready.push(x.to);
      }
  }

  // The caches among a part's outgoing wires, and what they front: the stores
  // each one is wired to (with the same kind of traffic). A cache wired to no
  // store sits beside the part's stores instead (cache-aside).
  const cachedBy = (out: Wire[], kind: "read" | "write") => {
    const fronted = new Set<string>();
    let aside = false;
    for (const x of out) {
      if (byId.get(x.to)!.kind !== "cache") continue;
      const behind = wires.filter(
        (y) =>
          y.from === x.to &&
          y.carries !== (kind === "read" ? "write" : "read") &&
          byId.get(y.to)!.kind !== "cache" &&
          KINDS[byId.get(y.to)!.kind].store,
      );
      for (const y of behind) fronted.add(y.to);
      if (!behind.length) aside = true;
    }
    return { fronted, aside };
  };

  const done = new Set<string>();
  for (const id of order) {
    done.add(id);
    const c = byId.get(id)!;
    const k = KINDS[c.kind];
    const outR = (r.get(id) ?? 0) * k.passRead;
    const outW = (w.get(id) ?? 0) * k.passWrite;
    const out = wires.filter((x) => x.from === id && !done.has(x.to));
    const reads = out.filter((x) => x.carries !== "write");
    const writes = out.filter((x) => x.carries !== "read");
    const rc = k.router ? NO_CACHE : cachedBy(reads, "read");
    const wc = k.router ? NO_CACHE : cachedBy(writes, "write");
    for (const x of reads) {
      const t = byId.get(x.to)!;
      // the cache in front of this store already sends it the misses
      if (rc.fronted.has(t.id)) continue;
      let amount = k.router ? outR / reads.length : outR;
      // cache-aside: a store read next to a cache that fronts no store of
      // its own sees only the misses
      if (rc.aside && t.kind !== "cache" && KINDS[t.kind].store)
        amount *= 1 - HIT;
      r.set(x.to, (r.get(x.to) ?? 0) + amount * x.times);
    }
    for (const x of writes) {
      // written through the cache in front of it: not a second time directly
      if (wc.fronted.has(x.to)) continue;
      const amount = k.router ? outW / writes.length : outW;
      w.set(x.to, (w.get(x.to) ?? 0) + amount * x.times);
    }
    if (k.async || asyncFrom.has(id)) for (const x of out) asyncFrom.add(x.to);
  }

  const load: Record<string, Load> = {};
  for (const c of s.comps) {
    const cap = capacity(c);
    const reads = Math.round(r.get(c.id) ?? 0);
    const writes = Math.round(w.get(c.id) ?? 0);
    // reads and writes share one capacity: each takes its share of what an
    // instance (or a store's node) can do, so 5k reads/s and 5k writes/s on
    // a 5k requests/s service is twice its capacity, not exactly it
    const util =
      (Number.isFinite(cap.read) ? reads / cap.read : 0) +
      (Number.isFinite(cap.write) ? writes / cap.write : 0);
    const isAsync = asyncFrom.has(c.id);
    load[c.id] = {
      reads,
      writes,
      capRead: cap.read,
      capWrite: cap.write,
      util: Math.round(util * 100) / 100,
      async: isAsync,
      status:
        reads + writes === 0
          ? "idle"
          : util > 1
            ? isAsync
              ? "backlog"
              : "over"
            : util > 0.7
              ? "busy"
              : "ok",
    };
  }
  return load;
}

// ---------------------------------------------------------------- edits

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "part";

function freshId(s: DesignState, base: string): string {
  const taken = new Set([
    ...s.comps.map((c) => c.id),
    ...s.wires.map((w) => w.id),
  ]);
  let id = slug(base);
  for (let i = 2; taken.has(id); i++) id = `${slug(base)}-${i}`;
  return id;
}

// A second "Service" becomes "Service 2", so every part can be told apart on
// the canvas and named in a review.
function uniqueLabel(s: DesignState, name: string): string {
  const taken = new Set(s.comps.map((c) => c.label));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const next = `${name.slice(0, 40 - String(i).length - 1)} ${i}`;
    if (!taken.has(next)) return next;
  }
}

export function addComp(
  s: DesignState,
  kind: unknown,
  label: unknown,
  x: unknown,
  y: unknown,
  by: Comp["by"] = "you",
  id?: string,
): Comp | null {
  if (!isKind(kind) || s.comps.length >= 60) return null;
  const name = uniqueLabel(s, str(label, 40).trim() || KINDS[kind].label);
  const c: Comp = {
    id:
      id && safeId(id) && !s.comps.some((o) => o.id === id)
        ? id
        : freshId(s, name),
    kind,
    label: name,
    x: num(x, -5000, 5000, 0),
    y: num(y, -5000, 5000, 0),
    count: 1,
    shards: 1,
    by,
  };
  s.comps.push(c);
  return c;
}

export const findComp = (s: DesignState, id: unknown) =>
  typeof id === "string" ? s.comps.find((c) => c.id === id) : undefined;

export function updateComp(s: DesignState, id: unknown, a: Raw): Comp | null {
  const c = findComp(s, id);
  if (!c) return null;
  if (a.label !== undefined) c.label = str(a.label, 40).trim() || c.label;
  if (a.count !== undefined) c.count = num(a.count, 1, 10_000, c.count);
  if (a.shards !== undefined && KINDS[c.kind].shards)
    c.shards = num(a.shards, 1, 10_000, c.shards);
  if (KINDS[c.kind].source)
    for (const key of ["readShare", "writeShare"] as const)
      if (a[key] !== undefined) c[key] = num(a[key], 0, 100, c[key] ?? 0);
  if (a.x !== undefined) c.x = num(a.x, -5000, 5000, c.x);
  if (a.y !== undefined) c.y = num(a.y, -5000, 5000, c.y);
  return c;
}

export function removeComp(s: DesignState, id: unknown): boolean {
  const c = findComp(s, id);
  if (!c) return false;
  const wires = s.wires.filter((w) => w.from === c.id || w.to === c.id);
  s.comps = s.comps.filter((o) => o !== c);
  s.wires = s.wires.filter((w) => !wires.includes(w));
  s.removed = [...(s.removed ?? []), { comp: c, wires }].slice(-10);
  return true;
}

// Undo the last removal: a part comes back where it was, with the wires whose
// other end is still there; a wire comes back if both its ends are there.
export function restoreRemoved(
  s: DesignState,
): { comp?: Comp; wires: Wire[] } | null {
  const last = s.removed?.pop();
  if (!last) return null;
  const { comp, wires } = last;
  if (comp) {
    if (s.comps.length >= 60 || findComp(s, comp.id)) return null;
    s.comps.push(comp);
  }
  const back: Wire[] = [];
  for (const w of wires)
    if (
      findComp(s, w.from) &&
      findComp(s, w.to) &&
      s.wires.length < 120 &&
      !s.wires.some(
        (o) => o.id === w.id || (o.from === w.from && o.to === w.to),
      )
    ) {
      s.wires.push(w);
      back.push(w);
    }
  if (!comp && !back.length) return null;
  return { comp, wires: back };
}

export function connect(
  s: DesignState,
  from: unknown,
  to: unknown,
  carries: unknown = "both",
  times: unknown = 1,
  // the dots you dragged between: kept only as a pair
  fromSide?: unknown,
  toSide?: unknown,
): Wire | null {
  const a = findComp(s, from);
  const b = findComp(s, to);
  if (!a || !b || a === b || s.wires.length >= 120) return null;
  if (s.wires.some((w) => w.from === a.id && w.to === b.id)) return null;
  const wire: Wire = {
    id: freshId(s, `${a.id}-${b.id}`),
    from: a.id,
    to: b.id,
    carries: carriesOf(carries),
    times: num(times, 1, 10_000, 1),
    ...(isSide(fromSide) && isSide(toSide) && { fromSide, toSide }),
  };
  s.wires.push(wire);
  return wire;
}

export function updateWire(s: DesignState, id: unknown, a: Raw): Wire | null {
  const wire = s.wires.find((w) => w.id === id);
  if (!wire) return null;
  if (a.carries !== undefined) wire.carries = carriesOf(a.carries);
  if (a.times !== undefined) wire.times = num(a.times, 1, 10_000, wire.times);
  return wire;
}

export function removeWire(s: DesignState, id: unknown): boolean {
  const w = s.wires.find((x) => x.id === id);
  if (!w) return false;
  s.wires = s.wires.filter((x) => x !== w);
  s.removed = [...(s.removed ?? []), { wires: [w] }].slice(-10);
  return true;
}

// ---------------------------------------------------------------- model ops

export function cleanBrief(raw: Raw): Brief | null {
  if (!raw || typeof raw !== "object") return null;
  const title = str(raw.title, 80).trim();
  if (!title) return null;
  return {
    title,
    goals: list(raw.goals, 6)
      .map((g) => str(g, 120))
      .filter(Boolean),
    constraints: list(raw.constraints, 6)
      .map((g) => str(g, 120))
      .filter(Boolean),
    scale: list(raw.scale, 6)
      .map((x) => ({ label: str(x?.label, 40), value: str(x?.value, 40) }))
      .filter((x) => x.label && x.value),
    reads: num(raw.reads, 0, 100_000_000, 0),
    writes: num(raw.writes, 0, 100_000_000, 0),
    readIs: str(raw.readIs, 60).trim(),
    writeIs: str(raw.writeIs, 60).trim(),
  };
}

export function cleanReference(raw: Raw): Reference | null {
  if (!raw || typeof raw !== "object") return null;
  const comps = list(raw.comps, 30)
    .filter((c) => isKind(c?.kind) && safeId(str(c?.id, 60)))
    .map((c) => ({
      id: str(c.id, 60),
      kind: c.kind as KindId,
      label: str(c.label, 40) || KINDS[c.kind as KindId].label,
    }));
  if (!comps.length) return null;
  const ids = new Set(comps.map((c) => c.id));
  const wires = list(raw.wires, 60)
    .filter((x) => ids.has(str(x?.from, 60)) && ids.has(str(x?.to, 60)))
    .map((x) => ({
      from: str(x.from, 60),
      to: str(x.to, 60),
      carries: carriesOf(x.carries),
      times: num(x.times, 1, 10_000, 1),
    }));
  return {
    comps,
    wires,
    notes: list(raw.notes, 8)
      .map((n) => str(n, 200))
      .filter(Boolean),
  };
}

export function cleanReview(
  raw: Raw,
  s: DesignState,
  now = Date.now(),
): Review | null {
  if (!raw || typeof raw !== "object") return null;
  const ids = new Set(s.comps.map((c) => c.id));
  const points: ReviewPoint[] = list(raw.points, 8)
    .map((p) => ({
      level: (p?.level === "good" || p?.level === "fix"
        ? p.level
        : "think") as ReviewPoint["level"],
      text: str(p?.text, 280).trim(),
      on: list(p?.on, 6)
        .map((x) => str(x, 60))
        .filter((x) => ids.has(x)),
    }))
    .filter((p) => p.text);
  const summary = str(raw.summary, 280).trim();
  if (!summary && !points.length) return null;
  return { at: now, summary, points };
}

// An op from the model's reply: brief, reference, place, wire, review.
// Returns how many things changed, or null when the op is not Design's.
export function applyDesignOp(s: DesignState, op: Raw): number | null {
  switch (op?.op) {
    case "brief": {
      const b = cleanBrief(op);
      if (!b) return 0;
      s.brief = b;
      return 1;
    }
    case "reference": {
      const ref = cleanReference(op);
      if (!ref) return 0;
      s.reference = ref;
      return 1;
    }
    case "place": {
      const c = addComp(
        s,
        op.kind,
        op.label,
        op.x ?? 80,
        op.y ?? 80 + s.comps.length * 30,
        "claude",
        str(op.id, 60),
      );
      if (c)
        updateComp(s, c.id, {
          readShare: op.readShare,
          writeShare: op.writeShare,
        });
      return c ? 1 : 0;
    }
    case "wire":
      return connect(s, op.from, op.to, op.carries, op.times) ? 1 : 0;
    case "review": {
      const rv = cleanReview(op, s);
      if (!rv) return 0;
      s.review = rv;
      return 1;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- outline

const fmt = (n: number) =>
  !Number.isFinite(n)
    ? "∞"
    : n >= 1e9
      ? `${+(n / 1e9).toFixed(1)}B`
      : n >= 1e6
        ? `${+(n / 1e6).toFixed(1)}M`
        : n >= 1e3
          ? `${+(n / 1e3).toFixed(1)}k`
          : String(n);

export function outlineOf(s: DesignState): string {
  const load = loadCheck(s);
  const shares = clientShares(s.comps);
  const lines: string[] = [];
  if (s.brief)
    lines.push(
      `DESIGN BRIEF: ${s.brief.title}. Peak ${fmt(s.brief.reads)} reads/s${s.brief.readIs ? ` (a read: ${s.brief.readIs})` : ""}, ${fmt(s.brief.writes)} writes/s${s.brief.writeIs ? ` (a write: ${s.brief.writeIs})` : ""}.`,
      ...s.brief.goals.map((g) => `- must: ${g}`),
      ...s.brief.constraints.map((g) => `- constraint: ${g}`),
      ...s.brief.scale.map((x) => `- scale: ${x.label}: ${x.value}`),
    );
  else lines.push("DESIGN BRIEF: not written yet.");
  lines.push(
    s.comps.length
      ? `THE LEARNER'S DESIGN (components; load is the rough check: reads and writes share a part's capacity, so its % already counts both; quote it, do not work it out again):\n${s.comps
          .map((c) => {
            const l = load[c.id];
            const k = KINDS[c.kind];
            const scale = `${c.count > 1 ? ` ×${c.count}` : ""}${k.shards && c.shards > 1 ? `, ${c.shards} shards` : ""}`;
            const cap = Number.isFinite(l.capRead)
              ? l.capRead === l.capWrite
                ? `, capacity ${fmt(l.capRead)} requests/s in all`
                : `, capacity ${fmt(l.capRead)} reads/s or ${fmt(l.capWrite)} writes/s in all`
              : "";
            const sh = shares[c.id];
            const makes = sh
              ? `, makes ${Math.round(sh.reads)}% of the brief's reads and ${Math.round(sh.writes)}% of its writes (set on the client, not by its wires)`
              : "";
            return `[${c.id}] ${k.label} "${c.label}"${scale}${makes} — ${fmt(l.reads)} reads/s, ${fmt(l.writes)} writes/s${cap}, ${Math.round(l.util * 100)}% of capacity (${l.status})${l.async ? ", async" : ""}`;
          })
          .join("\n")}`
      : "THE LEARNER'S DESIGN: empty so far.",
  );
  if (s.wires.length)
    lines.push(
      `WIRES:\n${s.wires
        .map(
          (w) =>
            `${w.from} → ${w.to}${w.carries !== "both" ? ` (${w.carries}s only)` : ""}${w.times > 1 ? ` ×${w.times}` : ""}`,
        )
        .join("\n")}`,
    );
  if (s.reference)
    lines.push(
      `REFERENCE DESIGN (yours, hidden from the learner: judge and hint with it, never paste it whole):\n${s.reference.comps
        .map((c) => `[${c.id}] ${KINDS[c.kind].label} "${c.label}"`)
        .join(
          "\n",
        )}\n${s.reference.wires.map((w) => `${w.from} → ${w.to}${w.times > 1 ? ` ×${w.times}` : ""}`).join("\n")}${s.reference.notes.length ? `\nNotes: ${s.reference.notes.join(" | ")}` : ""}`,
    );
  if (s.review)
    lines.push(
      `YOUR LAST REVIEW: ${s.review.summary} ${s.review.points.map((p) => `[${p.level}] ${p.text}`).join(" ")}`,
    );
  return lines.join("\n");
}
