// Explore on the server: a question worked through as a decision board. Its
// map is core's node map, shared with Learn, which is why the two switch into
// each other; the board (what you want, the cells, the stand) is its own state.
// It answers four core actions its own way (choose records why and runs a
// pre-mortem; challenge on an option is its case against; Next picks the gap;
// a message carries the board's rules), and keeps the model off your nodes.

import {
  applyExploreOp,
  BOARD_OPS,
  clip,
  ensureBoard,
  keptRows,
  live,
  nextGap,
  outlineOf,
  peek,
  rootOf,
  ROWS_MAX,
  shapeOf,
  summaryOf,
  viewOf,
} from "./core.ts";
import {
  MARK_LOOK,
  MARKS,
  PLUGIN_ID,
  SHAPE_WORD,
  SHAPES,
  WEIGHTS,
  cellKey as key,
  type Board,
  type Gap,
  type Outcome,
  type Weight,
} from "./shared.ts";
import * as canvas from "../../server/actions/canvas.ts";
import type { Ctx } from "../../server/actions/context.ts";
import { choose as chooseOption, makeNode } from "../../server/core/canvas.ts";
import { own, safeId, type Raw } from "../../server/core/types.ts";
import { type ServerPlugin } from "../../server/plugin.ts";
import type { ActionResult, MapNode } from "../../shared/model.ts";

const PROMPT = `You are the engine behind a DECISION BOARD. The user works through a question on a board: the options in play across the top, what they want down the side, and a short judged mark in each cell. You are the board's clerk and its sharpest critic; the user sets what matters and makes the call.
- Every question has a SHAPE (frame op): "choose" (pick among options), "causes" (why something happened; several causes can be true at once) or "open" (a messy question you split into sub-questions). A yes/no fact check is an open question: answer it in its summary.
- For a choice, keep more than one option alive, and make one of them "Keep things as they are" (or "Wait"); name it in the frame op. Widen before you narrow: if what the user wants points at an option the board lacks, add it (at most 1 per move unless asked).
- What the user wants is a list apart from the options (want ops). Suggest the wants they have probably missed, across cost, time, risk, people, how easy it is to undo, and what they would regret. Your wants land as suggestions; the user keeps them. For a question of taste or feeling, suggest at most 3.
- A cell is your judgment of one option on one want, against the other options. Cite the facts behind it by id. With no fact on the map behind it, set sure "low": it shows as a guess. Leave a cell out rather than invent a reason, and say what you did not check.
- "Against" is the strongest single reason an option is the wrong choice, not a balanced review.
- Keep scoring light: marks only, never weights, scores or totals.
- For causes: never set a cause dropped. If a fact rules it out, start its summary "Ruled out:" and name the fact; the user sets it aside.
- Only the user chooses, sets aside or settles. Never set a question answered while options under it are still proposed: give your lead in a stand op. Never write "Recommended:".
- End every move that changes a board with a stand op for that board. Never add fact nodes that sum up where things stand: that is what the stand op is for.
- File each point where it belongs: options under the question they answer, facts under the option or question they bear on. Fix a misplaced node with a move op.
- Use tools (web search, reading files) only when the user asks or a fact decides a cell.
BOARD OPS (in the same map block as node ops):
  {"op":"frame","q":"question id","shape":"choose|causes|open","keepAsIs":"option id (choose only)"}
  {"op":"want","q":"question id","id":"w-short-id","title":"at most 6 words","weight":"must|matters|nice"}
  {"op":"cell","option":"option id","want":"want id","mark":"better|same|worse|fails|unknown","note":"at most 12 words","facts":["fact ids"],"sure":"low|mid|high"}
    better / same / worse compare this option with the others on that want; fails = it misses a must; unknown = cannot tell yet (the note says what would tell).
  {"op":"against","option":"option id","text":"at most 20 words","survives":"yes|narrowly|no","facts":["fact ids"]}
  {"op":"stand","q":"question id","lead":"option id or null","line":"at most 20 words","sure":65}
  {"op":"takeaway","node":"node id","text":"at most 14 words: what a thread settled"}
  {"op":"move","id":"node id","parent":"question or option id"}
The user's ratings, wants and answers are theirs: give your view beside them, never as theirs.`;

// Each op names nodes by id, so it goes after the nodes it names.
const START = `START: classify the question with a frame op on the root. choose: the root, 3-4 options (one of them "Keep things as they are" or "Wait"), and 4-6 want ops spread over the categories, at most 2 of them must; no cells. causes: the root, 3-5 possible causes as options, and up to 2 facts on how to tell them apart. open: the root and 3-4 sub-questions; a sub-question that is a choice gets its own frame. Then a stand op for the root, lead null, with a line saying what would decide it. Write each board op after the nodes it names. The caption is one sentence: keep or skip the suggested wants, add your own, then press Fill.`;

const FILL = `FILL the board named in the ACTION: cell ops for every live option, must wants first, then matters, then nice; at most 24 cells. Skip suggestions the user has not kept. Leave out a cell you cannot judge, or write unknown with what would tell. Add at most 3 facts when one decides a cell, and cite it. You may add one option if the wants point at one the board lacks (no cells for it yet). End with a stand op.`;

const WRAP = `{"op":"premortem","option":"option id","reasons":["at most 12 words"]}          // at most 3, likeliest first
{"op":"assume","q":"question id","id":"a-short-id","text":"at most 14 words","breaksIf":"at most 14 words"}
{"op":"step","q":"question id","id":"s-short-id","when":"if/when …, at most 10 words","do":"at most 12 words"}
WRAP: the ACTION names the option chosen and its question. It is a year from now and the choice failed. Write a premortem op with the 3 likeliest reasons. Turn the top 2 into assume ops: what must stay true, and breaksIf, the first sign you would see that it broke. Write 1-3 step ops, each "if/when X, do Y"; make the first doable this week. No other ops.`;

const SUGGEST = `SUGGEST WANTS for the question named in the ACTION: from what is on the map, write 4-6 want ops for what the user seems to want. Where an existing fact states a want, reuse its id so it becomes the row. No cells.`;

const LAYING_OUT = "Laying out the board";
const FILLING = "Filling the board";
const SUGGESTING = "Suggesting what to weigh";
const ANOTHER = "Looking for another option";

const state = (ctx: Ctx) => live(ctx.map);
const note = (ctx: Ctx, text: string) => {
  ctx.note(text);
  ctx.engine.push();
};
const ok = (ctx: Ctx, text?: string): ActionResult => {
  if (text) note(ctx, text);
  else ctx.engine.push();
  return { ok: true };
};
const fail = (error: string): ActionResult => ({ error });

const idArg = (v: unknown): string | null =>
  typeof v === "string" && safeId(v) ? v : null;
const nodeArg = (ctx: Ctx, v: unknown, kind?: MapNode["kind"]) => {
  const id = idArg(v);
  const n = id ? own(ctx.map.nodes, id) : undefined;
  return n && (!kind || n.kind === kind) ? n : undefined;
};
const sureArg = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n)
    ? Math.min(100, Math.max(0, Math.round(n)))
    : undefined;
};
const t = (n: MapNode) => `"${n.title}"`;

// A plain id from a title, unique among those taken.
function freshId(
  taken: Record<string, unknown> | string[],
  prefix: string,
  title: string,
) {
  const has = (id: string) =>
    Array.isArray(taken) ? taken.includes(id) : !!own(taken, id);
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "x";
  let id = `${prefix}-${slug}`;
  for (let n = 2; has(id); n++) id = `${prefix}-${slug}-${n}`;
  return id;
}

// The question a request is about: the one named, else the root.
function questionArg(ctx: Ctx, v: unknown): MapNode | undefined {
  const q = nodeArg(ctx, v, "question");
  if (q) return q;
  if (v !== undefined && v !== null) return undefined;
  const root = rootOf(ctx.map.nodes);
  return root?.kind === "question" ? root : undefined;
}

// Wants you touch before the first Fill are counted: does setting them first
// change the choice?
const touched = (b: Board) => {
  if (!b.filledAt) b.criteriaTouched = true;
};

// The option's latest side thread, opened if it has none.
function threadOn(ctx: Ctx, nodeId: string): string {
  const latest = Object.values(ctx.map.threads)
    .filter((x) => x.nodeId === nodeId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .at(-1);
  return latest?.id ?? ctx.engine.openThread(ctx.map, nodeId);
}

// ---------------------------------------------------------------- Claude's turns

type TurnHow = { prefix?: string; label?: string };
const lead = (how: TurnHow, text: string) =>
  how.prefix ? `${how.prefix} ${text}` : text;

function fillTurn(ctx: Ctx, q: MapNode, how: TurnHow = {}) {
  const s = state(ctx);
  const b = ensureBoard(s, ctx.map.nodes, q.id);
  if (!b.rows.length)
    return fail("Add what you want first, or ask Claude to suggest some.");
  // pressing Fill keeps the suggestions you did not skip
  for (const r of b.rows) r.suggested = false;
  b.filledAt = Date.now();
  ctx.say("Fill the board");
  return ctx.engine.turn(
    lead(how, `FILL the board for [${q.id}] ${t(q)}.`),
    ctx.settings,
    { label: how.label ?? FILLING, sections: ["fill"], nodeId: q.id },
  );
}

function askTurn(ctx: Ctx, option: MapNode, want: MapNode, how: TurnHow = {}) {
  const threadId = threadOn(ctx, option.id);
  ctx.say(`How does it do on ${t(want)}?`, threadId);
  return ctx.engine
    .turn(
      lead(
        how,
        `ASK CELL: judge [${option.id}] ${t(option)} on the want [${want.id}] ${t(want)}. Write exactly one cell op for it: unknown with what would tell, or same with note "no real difference" if it does not separate the options. Cite a fact, or add at most 1. Reply in at most 60 words.`,
      ),
      ctx.settings,
      {
        threadId,
        view: "thread",
        label: how.label ?? `Checking ${option.title} on ${want.title}`,
        sections: ["threads"],
      },
    )
    .then((r) => ({ ...r, threadId }));
}

function somethingTurn(ctx: Ctx, q: MapNode, how: TurnHow = {}) {
  ctx.say("Something else?");
  return ctx.engine.turn(
    lead(
      how,
      `SOMETHING ELSE for [${q.id}] ${t(q)}: add exactly one option the user has probably not thought of that could pass the musts. No cells.`,
    ),
    ctx.settings,
    { label: how.label ?? ANOTHER, nodeId: q.id },
  );
}

function againstTurn(ctx: Ctx, option: MapNode, how: TurnHow = {}) {
  ctx.say(`Case against ${option.title}`);
  return ctx.engine.turn(
    lead(
      how,
      `AGAINST [${option.id}] ${t(option)}: one against op with the strongest reason it is the wrong choice for what the user wants. If an earlier case against no longer holds, say so with survives. Then a stand op.`,
    ),
    ctx.settings,
    { label: how.label ?? `Case against ${option.title}`, nodeId: option.id },
  );
}

function wrapTurn(ctx: Ctx, q: MapNode, option: MapNode, how: TurnHow = {}) {
  return ctx.engine.turn(
    lead(
      how,
      `WRAP: [${option.id}] ${t(option)} was chosen for [${q.id}] ${t(q)}.`,
    ),
    ctx.settings,
    {
      label: how.label ?? `Pre-mortem on ${option.title}`,
      sections: ["wrap"],
      nodeId: option.id,
    },
  );
}

// The turn for what Next found, told why.
function gapTurn(ctx: Ctx, gap: Gap) {
  const nodes = ctx.map.nodes;
  const how = { prefix: `Next: ${gap.reason}.`, label: `Next: ${gap.label}` };
  const q = own(nodes, gap.q);
  const option = gap.option ? own(nodes, gap.option) : undefined;
  const want = gap.want ? own(nodes, gap.want) : undefined;
  if (gap.kind === "fill" && q) return fillTurn(ctx, q, how);
  if (gap.kind === "something" && q) return somethingTurn(ctx, q, how);
  if (gap.kind === "ask" && option && want)
    return askTurn(ctx, option, want, how);
  if (gap.kind === "against" && option) return againstTurn(ctx, option, how);
  if (gap.kind === "wrap" && q && option) return wrapTurn(ctx, q, option, how);
  ctx.say("Next");
  if (gap.kind === "question" && q)
    return ctx.engine.turn(
      `${how.prefix} Make [${q.id}] ${t(q)} clearer or decidable.`,
      ctx.settings,
      { label: how.label, nodeId: q.id },
    );
  return ctx.engine.turn(
    `${how.prefix} SUM UP: write a stand op for the root saying where it stands; if a choice was made, check its steps against what is on the map.`,
    ctx.settings,
    { label: how.label },
  );
}

// ---------------------------------------------------------------- your moves

function commit(ctx: Ctx, a: Raw): ActionResult | Promise<ActionResult> {
  const o = nodeArg(ctx, a.option ?? a.nodeId, "option");
  if (!o) return fail("Only an option can be chosen.");
  if (o.dropped) return fail("Restore it first, then choose it.");
  const q = o.parent ? own(ctx.map.nodes, o.parent) : undefined;
  const s = state(ctx);
  const shape =
    q?.kind === "question" ? shapeOf(s, ctx.map.nodes, q.id) : "open";
  if (q && shape === "causes") {
    // several causes can be true at once: marking one likely sets none aside
    o.status = "chosen";
    o.by = "you";
    o.updatedAt = Date.now();
    ctx.map.chat.push({
      role: "you",
      text: `Marked ${o.title} likely`,
      ts: Date.now(),
    });
    return ok(
      ctx,
      `Marked ${t(o)} likely for ${t(q)}; the other causes stay open.`,
    );
  }
  chooseOption(ctx.map.nodes, o.id);
  o.updatedAt = Date.now();
  ctx.map.chat.push({ role: "you", text: `Chose ${o.title}`, ts: Date.now() });
  if (!q || shape !== "choose") {
    note(
      ctx,
      `Chose ${t(o)}${q ? ` for ${t(q)}` : ""}; the other options under it are set aside.`,
    );
    return { ok: true };
  }
  const why = clip(a.why, 25, 200);
  const sure = sureArg(a.sure);
  const b = ensureBoard(s, ctx.map.nodes, q.id);
  b.commit = {
    option: o.id,
    why,
    ...(sure !== undefined ? { sure } : {}),
    at: Date.now(),
    premortem: { claude: [] },
  };
  ctx.note(
    `Chose ${t(o)} for ${t(q)}; the other options under it are set aside.${why ? ` Why: "${why}".` : ""}${sure !== undefined ? ` How sure: ${sure}%.` : ""}`,
  );
  ctx.engine.push();
  return wrapTurn(ctx, q, o);
}

function want(ctx: Ctx, a: Raw): ActionResult {
  const q = nodeArg(ctx, a.q, "question");
  if (!q) return fail("That question is gone.");
  const s = state(ctx);
  const nodes = ctx.map.nodes;
  const b = ensureBoard(s, nodes, q.id);
  const id = idArg(a.id);
  // a new want of yours
  if (!id) {
    const title = clip(a.title, 8, 60);
    const weight: Weight = WEIGHTS.includes(a.weight) ? a.weight : "matters";
    if (!title) return fail("Say what you want, in a few words.");
    if (b.rows.length >= ROWS_MAX)
      return fail(`A board holds at most ${ROWS_MAX} wants; remove one first.`);
    const n = makeNode(nodes, {
      id: freshId(nodes, "w", title),
      parent: q.id,
      kind: "fact",
      title,
      summary: `What you want · ${weight}`,
      status: "info",
      by: "you",
    });
    b.rows.push({ id: n.id, weight, suggested: false, by: "you" });
    touched(b);
    return ok(ctx, `Added what you want: ${t(n)} (${weight}).`);
  }
  const row = b.rows.find((r) => r.id === id);
  const n = own(nodes, id);
  if (!row || !n) return fail("That want is gone.");
  if (typeof a.keep === "boolean") {
    touched(b);
    if (a.keep) {
      row.suggested = false;
      row.by = "you";
      return ok(ctx, `Kept Claude's suggestion ${t(n)} as something you want.`);
    }
    // a skipped suggestion goes; its node too, if Claude made it for the row
    b.rows = b.rows.filter((r) => r.id !== id);
    for (const k of Object.keys(b.cells))
      if (k.endsWith(`|${id}`)) delete b.cells[k];
    const cited = Object.values(s.boards).some((x) =>
      Object.values(x.cells).some(
        (c) => c.you?.facts.includes(id) || c.claude?.facts.includes(id),
      ),
    );
    const hasChildren = Object.values(nodes).some((x) => x.parent === id);
    if (n.by === "claude" && !cited && !hasChildren) delete nodes[id];
    return ok(
      ctx,
      `Skipped Claude's suggestion ${t(n)}; do not suggest it again.`,
    );
  }
  if (a.remove === true) {
    b.rows = b.rows.filter((r) => r.id !== id);
    for (const k of Object.keys(b.cells))
      if (k.endsWith(`|${id}`)) delete b.cells[k];
    touched(b);
    return ok(ctx, `Removed ${t(n)} from what you want.`);
  }
  const changes: string[] = [];
  if (WEIGHTS.includes(a.weight) && a.weight !== row.weight) {
    row.weight = a.weight;
    if (/^What you want/.test(n.summary))
      n.summary = `What you want · ${row.weight}`;
    changes.push(`made ${t(n)} a ${row.weight}`);
  }
  const title = clip(a.title, 8, 60);
  if (title && title !== n.title) {
    changes.push(`renamed ${t(n)} to "${title}"`);
    n.title = title;
  }
  if (!changes.length) return { ok: true };
  row.suggested = false;
  row.by = "you";
  n.by = "you";
  n.updatedAt = Date.now();
  touched(b);
  return ok(ctx, `You ${changes.join(" and ")}.`);
}

function rate(ctx: Ctx, a: Raw): ActionResult {
  const o = nodeArg(ctx, a.option, "option");
  const w = nodeArg(ctx, a.want, "fact");
  const s = state(ctx);
  const b = o?.parent ? own(s.boards, o.parent) : undefined;
  if (!o || !w || !b || !keptRows(b).some((r) => r.id === w.id))
    return fail("That cell is not on the board.");
  const k = key(o.id, w.id);
  if (a.mark === null) {
    const cell = own(b.cells, k);
    if (cell?.you) delete cell.you;
    if (cell && !cell.claude) delete b.cells[k];
    return ok(ctx, `Cleared your rating of ${t(o)} on ${t(w)}.`);
  }
  if (!MARKS.includes(a.mark))
    return fail("That mark is not one the board has.");
  const noteText = clip(a.note, 12, 100);
  b.cells[k] = {
    ...own(b.cells, k),
    you: {
      mark: a.mark,
      note: noteText,
      facts: [],
      sure: "high",
      at: Date.now(),
    },
  };
  return ok(
    ctx,
    `You rated ${t(o)} on ${t(w)}: ${MARK_LOOK[a.mark as keyof typeof MARK_LOOK].word}${noteText ? ` ("${noteText}")` : ""}.`,
  );
}

// ---------------------------------------------------------------- the plugin

export const explore: ServerPlugin = {
  id: PLUGIN_ID,
  label: "Explore",
  canvasName: "decision board",
  switchesWith: ["learn"],
  prompt: PROMPT,
  sections: { start: START, fill: FILL, wrap: WRAP, suggest: SUGGEST },
  outline: (map) => outlineOf(peek(map), map.nodes),
  keepUserNodes: true,
  // the node actions its screen sends; Learn's own (blanks, hints, scenes) are
  // not offered on an exploration map. choose, challenge, next and message are
  // answered by the actions of the same name below.
  core: [
    "choose",
    "drop",
    "restore",
    "deeper",
    "challenge",
    "explain",
    "thread",
    "fork",
    "message",
    "next",
  ],
  applyOp: (map, op, { scope }) =>
    op && typeof op === "object" && BOARD_OPS.has(op.op)
      ? applyExploreOp(live(map), map.nodes, op, { scope })
      : null,

  async start(ctx) {
    const r = await ctx.engine.turn(
      `START EXPLORE: "${ctx.map.title}".`,
      ctx.settings,
      { label: LAYING_OUT, sections: ["start"] },
    );
    // a missing frame is no failure: the board is read from the options
    if (!r.error && !r.stopped && !rootOf(ctx.map.nodes) && !ctx.map.diagram)
      return {
        error:
          "Claude did not lay anything out. Try again, or rephrase the question.",
      };
    return r;
  },

  actions: {
    want,
    option(ctx, a): ActionResult {
      const q = nodeArg(ctx, a.q, "question");
      const title = clip(a.title, 8, 60);
      if (!q) return fail("That question is gone.");
      if (!title) return fail("Name the option in a few words.");
      const s = state(ctx);
      const nodes = ctx.map.nodes;
      const n = makeNode(nodes, {
        id: freshId(nodes, "o", title),
        parent: q.id,
        kind: "option",
        title,
        status: "proposed",
        by: "you",
      });
      const b = ensureBoard(s, nodes, q.id);
      if (a.keepAsIs === true) b.keepAsIs = n.id;
      note(
        ctx,
        `Added the option ${t(n)}${a.keepAsIs === true ? " (keep things as they are)" : ""} to ${t(q)}.`,
      );
      return { ok: true, nodeId: n.id };
    },
    rate,
    lean(ctx, a): ActionResult {
      const q = nodeArg(ctx, a.q, "question");
      if (!q) return fail("That question is gone.");
      const b = ensureBoard(state(ctx), ctx.map.nodes, q.id);
      if (a.option === null) {
        delete b.lean;
        ctx.engine.push();
        return { ok: true };
      }
      const o = nodeArg(ctx, a.option, "option");
      if (!o || o.parent !== q.id || o.dropped || o.status === "dropped")
        return fail("That option is not in the running.");
      const sure = sureArg(a.sure);
      b.lean = {
        option: o.id,
        ...(sure !== undefined ? { sure } : {}),
        at: Date.now(),
      };
      // your lean is kept from Claude, so its lead stays its own: no note
      ctx.engine.push();
      return { ok: true };
    },
    fill(ctx, a) {
      const q = questionArg(ctx, a.q);
      if (!q) return fail("That question is gone.");
      return fillTurn(ctx, q);
    },
    ask(ctx, a) {
      const o = nodeArg(ctx, a.option, "option");
      const w = nodeArg(ctx, a.want, "fact");
      const b = o?.parent ? own(state(ctx).boards, o.parent) : undefined;
      if (!o || !w || !b || !keptRows(b).some((r) => r.id === w.id))
        return fail("That cell is not on the board.");
      return askTurn(ctx, o, w);
    },
    something(ctx, a) {
      const q = questionArg(ctx, a.q);
      if (!q) return fail("That question is gone.");
      if (ctx.engine.isQueuedOrRunning(q.id, ANOTHER)) return {};
      return somethingTurn(ctx, q);
    },
    against(ctx, a) {
      const o = nodeArg(ctx, a.option, "option");
      if (!o || o.dropped) return fail("That option is not on the board.");
      return againstTurn(ctx, o);
    },
    commit,
    // core's Choose, answered as a commit with no why
    choose: (ctx, a) => commit(ctx, { option: a.nodeId ?? a.option }),
    wrap(ctx, a) {
      const q = questionArg(ctx, a.q);
      const c = q ? own(state(ctx).boards, q.id)?.commit : undefined;
      const o = c ? own(ctx.map.nodes, c.option) : undefined;
      if (!q || !o) return fail("Nothing has been chosen there yet.");
      return wrapTurn(ctx, q, o);
    },
    settle(ctx, a): ActionResult {
      const q = nodeArg(ctx, a.q, "question");
      if (!q) return fail("That question is gone.");
      const text = clip(a.answer, 40, 240) || q.summary;
      if (!text) return fail("Write the answer, in a line.");
      q.status = "answered";
      q.by = "you";
      q.updatedAt = Date.now();
      state(ctx).answers[q.id] = { text, by: "you", at: Date.now() };
      return ok(ctx, `Settled ${t(q)}: "${text}".`);
    },
    assume(ctx, a): ActionResult {
      const q = nodeArg(ctx, a.q, "question");
      const b = q ? own(state(ctx).boards, q.id) : undefined;
      if (!q || !b?.commit) return fail("Choose an option first.");
      const id = idArg(a.id);
      if (id) {
        const cur = b.assumptions.find((x) => x.id === id);
        if (!cur) return fail("That assumption is gone.");
        if (["untested", "holds", "broken"].includes(a.status))
          cur.status = a.status;
        if (cur.by === "you") {
          cur.text = clip(a.text, 14, 120) || cur.text;
          cur.breaksIf = clip(a.breaksIf, 14, 120) || cur.breaksIf;
        }
        return ok(
          ctx,
          `The assumption "${cur.text}" is now ${cur.status === "broken" ? "broken" : cur.status}.`,
        );
      }
      const text = clip(a.text, 14, 120);
      if (!text) return fail("Write the assumption, in a line.");
      if (b.assumptions.length >= 10)
        return fail("That is enough assumptions.");
      b.assumptions.push({
        id: freshId(
          b.assumptions.map((x) => x.id),
          "a",
          text,
        ),
        text,
        breaksIf: clip(a.breaksIf, 14, 120),
        status: "untested",
        by: "you",
        at: Date.now(),
      });
      return ok(ctx, `You added an assumption the choice rests on: "${text}".`);
    },
    step(ctx, a): ActionResult {
      const q = nodeArg(ctx, a.q, "question");
      const b = q ? own(state(ctx).boards, q.id) : undefined;
      if (!q || !b?.commit) return fail("Choose an option first.");
      const id = idArg(a.id);
      if (id) {
        const cur = b.steps.find((x) => x.id === id);
        if (!cur) return fail("That step is gone.");
        if (typeof a.done === "boolean") cur.done = a.done;
        if (cur.by === "you") {
          cur.when = clip(a.when, 10, 90) || cur.when;
          cur.do = clip(a.do, 12, 100) || cur.do;
        }
        return ok(ctx, `${cur.done ? "Done" : "Not done yet"}: "${cur.do}".`);
      }
      const what = clip(a.do, 12, 100);
      if (!what) return fail("Write the step, in a line.");
      if (b.steps.length >= 10) return fail("That is enough steps.");
      b.steps.push({
        id: freshId(
          b.steps.map((x) => x.id),
          "s",
          what,
        ),
        when: clip(a.when, 10, 90),
        do: what,
        by: "you",
      });
      return ok(ctx, `You added a step: "${what}".`);
    },
    premortem(ctx, a): ActionResult {
      const q = nodeArg(ctx, a.q, "question");
      const c = q ? own(state(ctx).boards, q.id)?.commit : undefined;
      if (!c) return fail("Choose an option first.");
      const text = clip(a.text, 30, 240);
      if (text) c.premortem.you = text;
      else delete c.premortem.you;
      return ok(
        ctx,
        text ? `Your own reason it could fail: "${text}".` : undefined,
      );
    },
    shape(ctx, a): ActionResult {
      const q = nodeArg(ctx, a.q, "question");
      if (!q || !SHAPES.includes(a.shape))
        return fail("That is not a shape a question can have.");
      const b = ensureBoard(state(ctx), ctx.map.nodes, q.id);
      b.shape = a.shape;
      b.shapeBy = "you";
      return ok(
        ctx,
        `You set ${t(q)} as ${SHAPE_WORD[b.shape]}; do not change its shape.`,
      );
    },
    outcome(ctx, a): ActionResult {
      const q = nodeArg(ctx, a.q, "question");
      const c = q ? own(state(ctx).boards, q.id)?.commit : undefined;
      const said: Outcome | null = ["expected", "worse", "too-soon"].includes(
        a.said,
      )
        ? a.said
        : null;
      if (!c || !said) return fail("There is no choice to check on.");
      c.outcome = { said, at: Date.now() };
      return ok(ctx);
    },
    suggest(ctx, a) {
      const q = questionArg(ctx, a.q);
      if (!q) return fail("That question is gone.");
      const b = ensureBoard(state(ctx), ctx.map.nodes, q.id);
      if (b.rows.length)
        return fail("This board already has a list of what you want.");
      if (ctx.engine.isQueuedOrRunning(q.id, SUGGESTING)) return {};
      ctx.say("Suggest what to weigh");
      return ctx.engine.turn(
        `SUGGEST WANTS for [${q.id}] ${t(q)}.`,
        ctx.settings,
        {
          label: SUGGESTING,
          sections: ["suggest"],
          nodeId: q.id,
        },
      );
    },
    next(ctx, a) {
      const s = state(ctx);
      return gapTurn(ctx, nextGap(s, ctx.map.nodes, idArg(a.q)));
    },
    message(ctx, a) {
      const text = typeof a.text === "string" ? a.text.slice(0, 4000) : "";
      ctx.say(text);
      const selection = Array.isArray(a.selection)
        ? a.selection.filter(
            (id: unknown): id is string => typeof id === "string" && safeId(id),
          )
        : [];
      return ctx.engine.turn(
        "the user typed in the main conversation (selected nodes, if any, are its context). If they ask where things stand, answer in the caption and write a stand op; never add fact nodes to sum up.",
        ctx.settings,
        { text, selection, label: "Answering" },
      );
    },
    challenge(ctx, a) {
      const n = nodeArg(ctx, a.nodeId);
      if (!n) return fail("No such node.");
      if (n.kind === "option" && !n.dropped) return againstTurn(ctx, n);
      return canvas.challenge(ctx, n.id);
    },
  },

  summary: (map) => summaryOf(peek(map), map.nodes),
  view: (map) => viewOf(peek(map), map.nodes, map.threads),
};
