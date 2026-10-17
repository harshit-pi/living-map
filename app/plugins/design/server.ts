// Design on the server: the brief, the learner's components and wires, the
// rough load check, and Claude's review against a reference it keeps hidden.

import {
  addComp,
  applyDesignOp,
  connect,
  findComp,
  loadCheck,
  newState,
  outlineOf,
  removeComp,
  removeWire,
  restoreComp,
  updateComp,
  updateWire,
  type DesignState,
} from "./core.ts";
import { KINDS, PLUGIN_ID, type DesignView } from "./shared.ts";
import type { Ctx } from "../../server/actions/context.ts";
import { str, type StoredMap } from "../../server/core/types.ts";
import { stateOf, type ServerPlugin } from "../../server/plugin.ts";
import type { ActionResult } from "../../shared/model.ts";

const state = (map: StoredMap) =>
  stateOf<DesignState>(map, PLUGIN_ID, newState);

const PROMPT = `You are the engine behind a SYSTEM DESIGN CANVAS. The learner designs a system the way a good system-design book teaches it: requirements and scale first, then the high-level design, then deep dives into the hard parts, each one a trade-off. The learner builds the design; you set the brief, coach and review. You never draw the solution for them.
- The map's root question is the system (e.g. "How would you design Twitter?"). Its children are 3-5 DEEP DIVES: questions, open until the learner settles them, in the order to tackle them once the high-level design stands (e.g. "Fan-out on write or on read?", "What breaks when a celebrity tweets?", "How is the tweet store sharded?").
- The learner places and wires the components (THE LEARNER'S DESIGN below). You only place the clients at the start.
- HINT on a deep dive: add a fact under it titled "Hint 1" (then 2, 3) with one pointed question that leads to the idea, never the answer itself.
- When the learner answers a deep dive in its thread, judge it: if it holds up at the brief's scale, set it answered and say what they got right; if not, name the part that breaks, with numbers, not the fix.
- Talk to the learner as "you". Be concrete: real numbers from the brief and the load check, components by their names.
DESIGN OPS (in the same map block as node ops):
  {"op":"brief","title":"Design Twitter","goals":["post a tweet","see a home timeline"],"constraints":["timeline loads in under 200 ms"],"scale":[{"label":"Daily users","value":"200M"},{"label":"Tweets a day","value":"500M"}],"reads":300000,"writes":6000}
    goals and constraints at most 5 each, a few words each; scale at most 5 lines; reads and writes are PEAK requests per second that read and that write, following from the scale lines.
  {"op":"reference","comps":[{"id":"lb","kind":"lb","label":"Load balancer"}],"wires":[{"from":"app","to":"lb","carries":"both","times":1}],"notes":["one line per key decision"]}
    Your own complete high-level design for the brief, as a strong answer would draw it (8-16 components). Use the client's id from your place op. carries: read | write | both; times: fan-out (e.g. 200 when one tweet is written into each follower's feed).
  {"op":"place","id":"app","kind":"client","label":"Mobile app","x":40,"y":220}
  {"op":"review","summary":"one sentence","points":[{"level":"good|fix|think","text":"at most 40 words","on":["component ids"]}]}
COMPONENT KINDS: ${Object.entries(KINDS)
  .map(([id, k]) => `${id} (${k.hint})`)
  .join("; ")}.`;

const START = `START: write, in one map block: the root question (a node with parent null); the brief; your reference design; 3-5 deep dives as questions under the root; and place the client component(s) only, at x 40. The caption is one sentence telling the learner what to build first (the path from the client to the data, on the main read).`;

const REVIEW = `CHECK MY DESIGN: review the learner's design against the brief, the load check and your reference. Write one review op: 3-6 points, the most important first.
- good: something that works at this scale, said in a few words.
- fix: what breaks or is missing. Name the SYMPTOM with numbers from the load check (e.g. "Tweet store takes 300k reads/s, about 30x what one SQL node handles"), not the component that fixes it. If YOUR LAST REVIEW already raised the same problem and it is still there, you may now name the fix.
- think: one question that leads to the next idea in your reference.
Point "on" at the learner's component ids. If the design already settles a deep dive, set that question answered with a summary of what they chose. The caption is one sentence: the single most important thing to do next.`;

const REVIEWING = "Reviewing your design";

const note = (ctx: Ctx, text: string) => {
  ctx.note(text);
  ctx.engine.push();
};
const name = (s: DesignState, id: unknown) => {
  const c = findComp(s, id);
  return c ? `${KINDS[c.kind].label} "${c.label}"` : String(id);
};

export const design: ServerPlugin = {
  id: PLUGIN_ID,
  label: "Design",
  prompt: PROMPT,
  sections: { start: START, review: REVIEW },
  outline: (map) => outlineOf(state(map)),
  applyOp: (map, op, { scope }) => {
    // a side thread may hint and judge, but not rewrite the brief or the design
    if (scope && op?.op !== "review")
      return op?.op && ["brief", "reference", "place", "wire"].includes(op.op)
        ? 0
        : null;
    return applyDesignOp(state(map), op);
  },

  async start(ctx) {
    const r = await ctx.engine.turn(
      `START DESIGN: "${ctx.map.title}".`,
      ctx.settings,
      { label: "Writing the brief", sections: ["start"] },
    );
    if (!r.error && !r.stopped && !state(ctx.map).brief)
      return {
        error:
          "Claude did not write a brief. Try again, or name the system to design.",
      };
    return r;
  },

  actions: {
    add(ctx, a): ActionResult {
      const c = addComp(state(ctx.map), a.kind, a.label, a.x, a.y);
      if (!c) return { error: "That component cannot be added." };
      note(ctx, `Added ${KINDS[c.kind].label} "${c.label}".`);
      return { ok: true, nodeId: c.id };
    },
    update(ctx, a): ActionResult {
      const s = state(ctx.map);
      const before = findComp(s, a.id);
      const was = before && {
        label: before.label,
        count: before.count,
        shards: before.shards,
      };
      const c = updateComp(s, a.id, a);
      if (!c || !was) return { error: "That component is gone." };
      const changes = [
        c.label !== was.label && `renamed "${was.label}" to "${c.label}"`,
        c.count !== was.count &&
          `set "${c.label}" to ${c.count} ${KINDS[c.kind].store ? "replicas" : "instances"}`,
        c.shards !== was.shards && `split "${c.label}" into ${c.shards} shards`,
      ].filter(Boolean);
      if (changes.length) note(ctx, `${changes.join("; ")}.`);
      else ctx.engine.push(); // a move: saved, not worth telling Claude
      return { ok: true };
    },
    remove(ctx, a): ActionResult {
      const s = state(ctx.map);
      const label = name(s, a.id);
      if (!removeComp(s, a.id)) return { error: "That component is gone." };
      note(ctx, `Removed ${label}.`);
      return { ok: true };
    },
    connect(ctx, a): ActionResult {
      const s = state(ctx.map);
      const w = connect(s, a.from, a.to, a.carries);
      if (!w)
        return {
          error: "Those two cannot be wired (already wired, or the same part).",
        };
      note(ctx, `Wired ${name(s, w.from)} → ${name(s, w.to)}.`);
      return { ok: true };
    },
    wire(ctx, a): ActionResult {
      const s = state(ctx.map);
      const w = updateWire(s, a.id, a);
      if (!w) return { error: "That wire is gone." };
      note(
        ctx,
        `The wire ${name(s, w.from)} → ${name(s, w.to)} now carries ${w.carries === "both" ? "reads and writes" : `${w.carries}s only`}${w.times > 1 ? `, ×${w.times} each` : ""}.`,
      );
      return { ok: true };
    },
    unwire(ctx, a): ActionResult {
      const s = state(ctx.map);
      const w = s.wires.find((x) => x.id === a.id);
      if (!w || !removeWire(s, a.id)) return { error: "That wire is gone." };
      note(ctx, `Removed the wire ${name(s, w.from)} → ${name(s, w.to)}.`);
      return { ok: true };
    },
    undo(ctx): ActionResult {
      const s = state(ctx.map);
      const c = restoreComp(s);
      if (!c) return { error: "Nothing to undo." };
      note(ctx, `Put back ${name(s, c.id)}, which was removed by mistake.`);
      return { ok: true, nodeId: c.id };
    },
    check(ctx) {
      if (!state(ctx.map).comps.length)
        return { error: "Place a few components first, then check." };
      // a second click while a review runs or waits asks for the same review
      if (ctx.engine.isQueuedOrRunning(null, REVIEWING)) return {};
      ctx.say("Check my design.");
      return ctx.engine.turn(`CHECK MY DESIGN.`, ctx.settings, {
        label: REVIEWING,
        sections: ["review"],
      });
    },
    reveal(ctx): ActionResult {
      const s = state(ctx.map);
      if (!s.reference)
        return { error: "There is no reference design on this map." };
      s.revealed = true;
      note(ctx, "The learner opened your reference design.");
      return { ok: true };
    },
    message(ctx, a) {
      const text = str(a.text, 4000).trim();
      if (!text) return { ok: true };
      ctx.say(text);
      return ctx.engine.turn(
        "The learner wrote in the main conversation. Answer about their design: coach, do not hand over the reference.",
        ctx.settings,
        { text, label: "Replying", sections: [] },
      );
    },
  },

  summary(map) {
    const s = state(map);
    const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
    return `${n(s.comps.length, "part")} · ${n(s.wires.length, "wire")}${s.review ? " · reviewed" : ""}`;
  },

  view(map): DesignView {
    const s = state(map);
    return {
      brief: s.brief,
      comps: s.comps,
      wires: s.wires,
      load: loadCheck(s),
      review: s.review,
      reference: s.revealed ? s.reference : null,
    };
  },
};
