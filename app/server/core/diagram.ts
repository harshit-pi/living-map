// The topic diagram: cleaning what the model drew, keeping what you solved,
// and reading it back to the model.

import { list, str, type BlankAnswer, type Raw } from "./types.ts";
import type { Diagram, DiagramForm, Fill } from "../../shared/model.ts";

export const FORMS = new Set<DiagramForm>([
  "sequence",
  "concept",
  "timeline",
  "structure",
  "grid",
]);

type Element = {
  id: string;
  blank?: boolean;
  prompt?: string;
  filled?: boolean;
  label?: string;
  text?: string;
};

// A blank keeps its accepted answers only until cleanSpec moves them aside:
// they never stay in the diagram the browser gets.
type Pending = { _accept?: string[]; _why?: string };

function blankOf(x: Raw, field: "label" | "text") {
  if (!x?.blank) return null;
  return {
    id: str(x.id, 40) || `b${Math.random().toString(36).slice(2, 7)}`,
    blank: true,
    prompt: str(x.prompt, 90),
    [field]: "",
    _accept: list(x.accept, 6)
      .map((a) => str(String(a ?? ""), 60))
      .filter(Boolean),
    _why: str(x.why, 200),
  };
}

// The same answer typed differently: case, spacing, brackets, quotes and the
// typographic minus do not matter.
export const normAnswer = (s: unknown): string =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/[\s()[\]{}"'`]/g, "")
    .replace(/[.!]+$/, "");

export const accepts = (a: BlankAnswer | undefined, text: string): boolean =>
  !!a &&
  a.accept.some(
    (x) => normAnswer(x) === normAnswer(text) && normAnswer(x) !== "",
  );

// Keep only what each form needs, cap sizes, and strip any text from blanks so
// an answer can never reach the browser.
function cleanForm(spec: Raw): Diagram | null {
  if (!spec || !FORMS.has(spec.form)) return null;
  const title = str(spec.title, 80);
  switch (spec.form as DiagramForm) {
    case "sequence": {
      // every party a step names gets a lane, even if the model left it out of "lanes"
      const lanes = list(spec.lanes, 6)
        .map((l) => str(l, 50))
        .filter(Boolean);
      for (const st of list(spec.steps, 14))
        for (const who of [str(st?.from, 50), str(st?.to, 50)])
          if (
            who &&
            lanes.length < 6 &&
            !lanes.some((l) => l.toLowerCase() === who.toLowerCase())
          )
            lanes.push(who);
      return {
        form: "sequence",
        title,
        lanes,
        steps: list(spec.steps, 14).map((s, i) => {
          const b = blankOf(s, "label");
          const ends = { from: str(s.from, 50), to: str(s.to, 50) };
          return b
            ? { ...b, label: "", ...ends }
            : {
                id: str(s.id, 40) || `s${i}`,
                ...ends,
                label: str(s.label, 60),
              };
        }),
      };
    }
    case "concept":
      return {
        form: "concept",
        title,
        nodes: list(spec.nodes, 12).map(
          (n, i) =>
            (blankOf(n, "label") as { id: string; label: string } | null) ?? {
              id: str(n.id, 40) || `n${i}`,
              label: str(n.label, 40),
              note: str(n.note, 70),
            },
        ),
        links: list(spec.links, 18).map((l) => ({
          from: str(l.from, 40),
          to: str(l.to, 40),
          label: str(l.label, 30),
        })),
      };
    case "timeline":
      return {
        form: "timeline",
        title,
        events: list(spec.events, 12).map((e, i) => {
          const b = blankOf(e, "label");
          return b
            ? { ...b, label: "", when: str(e.when, 20) }
            : {
                id: str(e.id, 40) || `e${i}`,
                when: str(e.when, 20),
                label: str(e.label, 50),
                note: str(e.note, 80),
              };
        }),
      };
    case "structure":
      return {
        form: "structure",
        title,
        boxes: list(spec.boxes, 12).map(
          (b, i) =>
            (blankOf(b, "label") as { id: string; label: string } | null) ?? {
              id: str(b.id, 40) || `x${i}`,
              label: str(b.label, 40),
              rows: list(b.rows, 5).map((r) => str(r, 50)),
            },
        ),
        arrows: list(spec.arrows, 18).map((a) => ({
          from: str(a.from, 40),
          to: str(a.to, 40),
          label: str(a.label, 30),
        })),
      };
    case "grid":
      return {
        form: "grid",
        title,
        columns: list(spec.columns, 5).map((c) => str(c, 30)),
        rows: list(spec.rows, 8).map((r, i) => ({
          label: str(r.label, 40),
          cells: list(r.cells, 5).map((c, j) =>
            typeof c === "string"
              ? { id: `c${i}-${j}`, text: str(c, 60) }
              : ((blankOf(c, "text") as {
                  id: string;
                  text: string;
                } | null) ?? {
                  id: str(c?.id, 40) || `c${i}-${j}`,
                  text: str(c?.text, 60),
                }),
          ),
        })),
      };
  }
}

// Every part of a diagram gets an id of its own: you click parts by id, blanks
// are checked by id, and React keys rows by id.
export function cleanSpec(spec: Raw): Diagram | null {
  return cleanSpecWithAnswers(spec)?.diagram ?? null;
}

// The diagram for the browser, and each blank's accepted answers kept apart.
export function cleanSpecWithAnswers(
  spec: Raw,
): { diagram: Diagram; answers: Record<string, BlankAnswer> } | null {
  const d = cleanForm(spec);
  if (!d) return null;
  const seen = new Set<string>();
  const answers: Record<string, BlankAnswer> = {};
  for (const el of elementsOf(d) as (Element & Pending)[]) {
    let id = el.id || "part";
    for (let n = 2; seen.has(id); n++) id = `${el.id || "part"}-${n}`;
    el.id = id;
    seen.add(id);
    if (el._accept?.length)
      answers[id] = { accept: el._accept, why: el._why ?? "" };
    delete el._accept;
    delete el._why;
  }
  return { diagram: d, answers };
}

export function elementsOf(spec: Diagram): Element[] {
  switch (spec.form) {
    case "sequence":
      return spec.steps;
    case "concept":
      return spec.nodes;
    case "timeline":
      return spec.events;
    case "structure":
      return spec.boxes;
    case "grid":
      return spec.rows.flatMap((r) => r.cells);
  }
}

const setText = (el: Element, text: string) => {
  if ("text" in el) el.text = text;
  else el.label = text;
};

// A redrawn diagram keeps what you already got right, even when the model sends
// that part as a blank again or without its "filled" mark.
export function keepFilled(spec: Diagram, fills: Record<string, Fill>) {
  for (const el of elementsOf(spec)) {
    const f = fills[el.id];
    if (f?.state !== "right") continue;
    if (el.blank) {
      el.blank = false;
      delete el.prompt;
      setText(el, f.text);
    }
    el.filled = true;
  }
}

export function revealBlank(spec: Diagram | null, id: string, label: string) {
  if (!spec) return;
  for (const el of elementsOf(spec)) {
    if (el.id === id && el.blank) {
      el.blank = false;
      setText(el, label);
      el.filled = true;
    }
  }
}

// The diagram as the model reads it back: blanks shown with what you typed.
export function diagramOutline(
  spec: Diagram | null,
  fills: Record<string, Fill> = {},
  answers: Record<string, BlankAnswer> = {},
): string {
  if (!spec) return "(no diagram yet)";
  // the model sees what each blank accepts, so it judges consistently and keeps
  // the answers when it redraws (the browser never gets this)
  const b = (el: Element) =>
    el.blank
      ? `[BLANK ${el.id}: "${el.prompt}"${answers[el.id] ? `, accepts ${answers[el.id].accept.map((a) => `"${a}"`).join(" | ")}` : ""}${fills[el.id]?.text ? `, learner wrote "${fills[el.id].text}" (${fills[el.id].state ?? "unjudged"})` : ""}]`
      : "";
  const lines = [`form: ${spec.form} · ${spec.title}`];
  if (spec.form === "sequence") {
    lines.push(`lanes: ${spec.lanes.join(", ")}`);
    for (const s of spec.steps)
      lines.push(`- ${s.id}: ${s.from} → ${s.to}: ${s.blank ? b(s) : s.label}`);
  } else if (spec.form === "concept") {
    for (const n of spec.nodes)
      lines.push(
        `- ${n.id}: ${n.blank ? b(n) : `${n.label}${n.note ? ` (${n.note})` : ""}`}`,
      );
    for (const l of spec.links) lines.push(`  ${l.from} —${l.label}→ ${l.to}`);
  } else if (spec.form === "timeline") {
    for (const e of spec.events)
      lines.push(`- ${e.id} ${e.when}: ${e.blank ? b(e) : e.label}`);
  } else if (spec.form === "structure") {
    for (const x of spec.boxes)
      lines.push(
        `- ${x.id}: ${x.blank ? b(x) : `${x.label} ${x.rows?.length ? `[${x.rows.join("; ")}]` : ""}`}`,
      );
    for (const a of spec.arrows) lines.push(`  ${a.from} —${a.label}→ ${a.to}`);
  } else {
    lines.push(`columns: ${spec.columns.join(" | ")}`);
    for (const r of spec.rows)
      lines.push(
        `- ${r.label}: ${r.cells.map((c) => (c.blank ? b(c) : c.text)).join(" | ")}`,
      );
  }
  return lines.join("\n");
}
