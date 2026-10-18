// Learn's test kit: a model on the immune system (first infection: 7 parts,
// 6 links, 3 key) and the engine with a scripted Claude, shared by the
// Learn test files so each stays small.

import {
  addLinks,
  addMiscon,
  cleanModel,
  newState,
  setPredict,
  setWhatIf,
  type LearnState,
  type RefModel,
} from "./core.ts";
import type { Verb } from "./shared.ts";
import { act } from "../../server/actions/index.ts";
import type { Raw, StoredMap } from "../../server/core/types.ts";
import { createEngine } from "../../server/engine.ts";
import type {
  ModelProvider,
  ModelReply,
  ModelRequest,
} from "../../server/providers/types.ts";
import { newMap } from "../../server/store.ts";
import type { MapNode, ServerEvent } from "../../shared/model.ts";

// the immune system, first infection: 7 parts, 6 links, 3 of them key
export const PARTS = [
  {
    id: "virus",
    label: "Flu virus",
    role: "the invader, met for the first time",
  },
  {
    id: "dendritic",
    label: "Dendritic cell",
    role: "carries pieces of the invader to a lymph node",
  },
  { id: "helpert", label: "Helper T cell", role: "gives the go signal" },
  {
    id: "bcell",
    label: "B cell",
    role: "can make one shape of protein",
    accept: ["b lymphocyte"],
  },
  { id: "plasma", label: "Plasma cell", role: "a factory that lives for days" },
  {
    id: "antibody",
    label: "Antibody",
    role: "a protein that sticks to the invader",
  },
  {
    id: "memb",
    label: "Memory B cell",
    role: "waits for years, ready to divide",
    accept: ["memory lymphocyte"],
  },
];
export const KEY = (id: string, from: string, to: string, rel: Verb) => ({
  id,
  from,
  to,
  rel,
  key: true,
  hint: `What does it lead to on day ${id.length + 10}?`,
  ask: `Why does ${id} hold?`,
  rubric: `the rubric of ${id}`,
  reversed: `The arrow of ${id} points the other way.`,
});
export const LINKS = [
  { id: "l1", from: "virus", to: "dendritic", rel: "picked up by" },
  { id: "l2", from: "dendritic", to: "helpert", rel: "shows to" },
  KEY("l3", "helpert", "bcell", "activates"),
  KEY("l4", "bcell", "memb", "becomes"),
  { id: "l5", from: "bcell", to: "plasma", rel: "becomes" },
  KEY("l6", "plasma", "antibody", "makes"),
];
// a new case's links: the same key links, other links around them
export const CASE_LINKS = [
  ...LINKS.filter((l) => "key" in l),
  { id: "l7", from: "virus", to: "helpert", rel: "activates" },
  { id: "l8", from: "dendritic", to: "plasma", rel: "sends to" },
];
export const MISCON = [
  {
    id: "x1",
    claim: "Antibodies are the memory",
    refute: "Antibody levels fall within months; what lasts is cells.",
    link: { from: "antibody", to: "memb", rel: "becomes" },
  },
];
export const PREDICT = {
  ask: "What is still there on day 60?",
  choices: [
    { text: "Memory B cell" },
    { text: "More antibody", miscon: "x1" },
    { text: "Killer T cell" },
  ],
  answer: "Memory B cell",
  hides: "l4",
};
export const WHATIF = {
  fails: "helpert",
  ask: "Your helpers are wiped out, as in HIV. What stops working?",
  affected: ["bcell", "plasma", "antibody"],
  why: "They need a go signal before they multiply.",
};

export const MODEL_OPS = (step: string, id = "m1") => [
  {
    op: "model",
    id,
    step,
    mode: "build",
    title: "Flu, your first infection",
    case: "days 0-14, a virus you have never met",
    layer: "behaviour",
    frame: { kind: "free" },
    parts: PARTS,
  },
  { op: "links", model: id, links: LINKS },
  { op: "miscon", model: id, items: MISCON },
  { op: "predict", model: id, ...PREDICT },
  { op: "whatif", model: id, ...WHATIF },
];

// a later step on the same cast: other key links and another what-if (the
// same ones would be refused as a repeat of step 1)
export const NEXT_OPS = (step: string, id = "m1") => {
  const ops: Raw[] = MODEL_OPS(step, id);
  ops[1] = {
    op: "links",
    model: id,
    links: LINKS.map((l) =>
      l.id === "l1" || l.id === "l2"
        ? KEY(l.id, l.from, l.to, l.rel as Verb)
        : l.id === "l3" || l.id === "l6"
          ? { id: l.id, from: l.from, to: l.to, rel: l.rel }
          : l,
    ),
  };
  ops[4] = { ...ops[4], fails: "dendritic", affected: ["helpert", "bcell"] };
  return ops;
};

export function scripted() {
  const calls: { req: ModelRequest; release: (text: string) => void }[] = [];
  const provider: ModelProvider = {
    name: "scripted",
    models: [{ id: "", label: "Default" }],
    efforts: [{ id: "", label: "Default" }],
    run(req, onText) {
      let release: (text: string) => void = () => {};
      const reply = new Promise<ModelReply>((resolve) => {
        release = (text) => {
          onText(text);
          resolve({
            ok: true,
            final: text,
            firstMs: 1,
            endMs: 2,
            usage: Promise.resolve(null),
          });
        };
      });
      calls.push({ req, release: (t) => release(t) });
      return { reply, cancel: () => release("") };
    },
  };
  return { provider, calls };
}

export function setup(initial: StoredMap | null = null) {
  const { provider, calls } = scripted();
  const events: ServerEvent[] = [];
  const engine = createEngine({
    provider,
    hub: { add: () => {}, remove: () => {}, emit: (e) => events.push(e) },
    initial,
    save: () => {},
  });
  return { engine, calls, events };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
export const settled = async (calls: unknown[], n: number) => {
  for (let i = 0; i < 50 && calls.length < n; i++) await tick();
};
export const reply = (ops: Raw[], caption = "Here you go.") =>
  `${caption}\n\`\`\`map\n{"ops":[\n${ops.map((o) => JSON.stringify(o)).join(",\n")}\n]}\n\`\`\``;
export const PATH_OPS = [
  {
    op: "add",
    id: "root",
    parent: null,
    kind: "question",
    title: "How does it remember?",
  },
  {
    op: "add",
    id: "s1",
    parent: "root",
    kind: "question",
    title: "First infection?",
  },
  {
    op: "add",
    id: "s2",
    parent: "root",
    kind: "question",
    title: "Second infection?",
  },
  {
    op: "add",
    id: "s3",
    parent: "root",
    kind: "question",
    title: "Why the first is slow?",
  },
];
export const learnAct = (name: string, args: Raw = {}) =>
  ({ type: "plugin", plugin: "learn", name, args }) as Parameters<
    typeof act
  >[1];
export const S = (m: StoredMap) => m.data!.learn as LearnState;

export function model(over: Raw = {}): RefModel {
  const m = cleanModel({ ...MODEL_OPS("s1")[0], ...over })!;
  addLinks(m, over.links ?? LINKS);
  addMiscon(m, MISCON);
  setPredict(m, PREDICT);
  setWhatIf(m, WHATIF);
  m.status = "ready";
  return m;
}

export const node = (
  id: string,
  parent: string | null,
  title: string,
  order: number,
  over: Partial<MapNode> = {},
): MapNode => ({
  id,
  parent,
  kind: "question",
  title,
  summary: "",
  detail: "",
  status: "open",
  by: "claude",
  updatedAt: 0,
  order,
  ...over,
});

export function pathMap(
  title = "How does the immune system remember a virus?",
) {
  const m = newMap(title, "learn");
  m.nodes.root = node("root", null, title, 0);
  m.nodes.s1 = node("s1", "root", "First infection?", 1);
  m.nodes.s2 = node("s2", "root", "Second infection?", 2);
  m.nodes.s3 = node("s3", "root", "Why the first is slow?", 3);
  return m;
}

// a build map whose steps all have a ready model, at the level given
export function buildMap(level: LearnState["level"] = "new") {
  const m = pathMap();
  const s = newState("build");
  s.level = level;
  for (const step of ["s1", "s2", "s3"]) {
    const mo = model({ step, id: `m-${step}` });
    mo.id = `m-${step}`;
    s.models[mo.id] = mo;
    s.stepModel[step] = mo.id;
  }
  m.data = { learn: s };
  return { m, s };
}
