// Chat on the server: what the model is told when it files the conversation's
// new turns, side chats (each one resumes your whole conversation, so it
// knows everything said there), ticking tasks off, and what the main
// conversation is told of it all the next time you write there.

import {
  canvasOf,
  cleanItemOp,
  contextPage,
  digest,
  post,
  prune,
  ROOT,
  setTask,
  takeUnsent,
} from "./core.ts";
import {
  catchUp,
  chatState,
  contextFile,
  readNew,
  writeContext,
} from "./follow.ts";
import { PLUGIN_ID, type ChatView, type ItemState } from "./shared.ts";
import { thread } from "../../server/actions/canvas.ts";
import type { Ctx } from "../../server/actions/context.ts";
import { makeNode } from "../../server/core/canvas.ts";
import { own, str, type StoredMap } from "../../server/core/types.ts";
import type { ServerPlugin } from "../../server/plugin.ts";
import type { ActionResult } from "../../shared/model.ts";

const PROMPT = `You keep a LIVE MAP OF A CONVERSATION. The user works with Claude in Claude Code: that is the MAIN CHAT. Beside it, this map shows at a glance what the main chat is about, what is still to do, what was decided and what is still open, and lets the user start a side chat from any part of it. You file the main chat's turns onto the map as they come, and you answer side chats.
- [root] is the conversation itself; never add or remove it.
- Under the root: TOPICS, the threads of discussion in the order they came up (e.g. "Teleport the cloud session", "Install the skill", "Pivot to a live chat map"). A new topic starts when the conversation turns to something else. A digression is a topic under the topic it branched from. Keep topics few and big: up to 8 under the root (this overrides the 5-children rule there), merging small ones.
- Under each topic, its ITEMS (at most 6):
  task: something that should be done. Every request in a user message is a task (several asks are several tasks), and so is work Claude said it would do or that is left over. State pending until a later turn shows it done ("done") or given up ("dropped").
  decision: something settled; the title says what was chosen.
  question: asked and not yet answered, or a choice still open. State open until answered; once it is, set it answered with the answer in its summary, or turn it into a decision.
  option: one of the choices Claude offered, under the question it answers (when Claude lists approaches or next steps, the choice is a question and each one an option, at most 5). State open until the user takes it ("chosen") or it is passed over ("dropped"). An option is the user's to choose: set "chosen" only when the conversation shows they picked it.
- Claude's closing offers ("Want me to …?", "I can also …") are not tasks, questions or options: leave them off the map unless the user takes one up, and then it is a task.
  note: a fact found along the way that matters later (a path, an error, a limit).
- Titles at most 7 words, in the user's own words where you can; summaries at most 20 words, concrete (names, paths, numbers).
- Never repeat what the map already shows: update it. A node "(ticked by user)" keeps the state the user gave it.
- Ids are short kebab-case and say what the node is (e.g. "teleport-branch").
For this canvas, write "type" and "state" in place of "kind" and "status" (kind and status follow from them), and "turn": the turn number it comes from. A node whose parent is the root is always a topic; items go under a topic:
  {"op":"add","id":"setup","parent":"root","type":"topic","turn":4,"title":"Set up Living Map locally","summary":"Skill installed; server runs on port 4317"}
  {"op":"add","id":"skill-install","parent":"setup","type":"task","state":"pending","turn":4,"title":"Install the living-map skill","summary":"npm run skill writes ~/.claude/skills/living-map"}
  {"op":"update","id":"skill-install","state":"done","summary":"Installed; /living-map now opens the map"}
  {"op":"summary","text":"2-4 sentences: where the conversation stands now and what comes next."}
SIDE CHATS: a message may come from a side chat on one node. There you are a colleague who has read the whole main chat: answer the side question fully and concretely from it, looking things up (read files, search) when it needs that. What you answer is passed back to the main chat, so lead with the answer. Change only that node and what is under it (e.g. answer a question it settles).`;

const FOLLOW = `FOLLOW: file the new turns onto the map. Add the topics and items they bring, and update the ones they change (a task now done, a question now answered, an option taken). The last op is always the summary op, even when little changed. Write only the map block: no words before or after it.`;

const SIDE = `Answer in at most 250 words of markdown. No headings.`;

const ofMap = (ctx: Ctx) => chatState(ctx.map);

// the conversation itself, the trunk every topic hangs from
function ensureRoot(map: StoredMap) {
  if (map.nodes[ROOT]) return;
  const root = makeNode(map.nodes, {
    id: ROOT,
    parent: null,
    kind: "fact",
    title: map.conversation?.title || map.title,
    summary: "",
    by: "you",
  });
  delete root.fresh;
}

export const chat: ServerPlugin = {
  id: PLUGIN_ID,
  label: "Chat",
  canvasName: "live map of the conversation",
  prompt: PROMPT,
  sections: { follow: FOLLOW, side: SIDE },
  canvas: (map) => canvasOf(map, chatState(map)),
  outline: (map, move) => {
    const s = chatState(map);
    const parts = [
      s.summary ? `WHERE IT STOOD AT THE LAST UPDATE: ${s.summary}` : "",
    ];
    if (move?.sections.includes("follow"))
      parts.push(`NEW IN THE CONVERSATION:\n${digest(s) || "(nothing new)"}`);
    return parts.filter(Boolean).join("\n\n");
  },
  cleanOp: (map, op, opts) =>
    cleanItemOp(chatState(map), op, map.nodes, opts?.scope ?? null),
  applyOp: (map, op, { scope }) => {
    if (op?.op !== "summary") return null;
    // a side chat answers its own node; the summary is the main chat's, and
    // is let go quietly (counted as refused, it buried the side chat's answer)
    if (scope) return null;
    const text = str(op.text, 1200).trim();
    if (!text) return 0;
    chatState(map).summary = text;
    return 1;
  },
  // a topic's panel: its side chats, telling more about it, setting it aside
  core: ["thread", "fork", "explain", "drop", "restore"],

  async start(ctx) {
    ensureRoot(ctx.map);
    readNew(ctx.map);
    ctx.engine.push();
    if (!ctx.map.conversation)
      return {
        error:
          "A chat map follows one of your Claude Code conversations: open it from there with /living-map.",
      };
    const r = await catchUp(ctx.engine, ctx.map);
    return r.ok ? {} : r;
  },

  actions: {
    // A side chat: your whole conversation, read before the question, so it
    // answers knowing everything said there. What it answers goes into the
    // main chat's inbox.
    async thread(ctx, a): Promise<ActionResult> {
      const nodeId = str(a.nodeId, 60) || ROOT;
      const text = str(a.text, 4000).trim();
      if (!text) return { error: "Say something first." };
      ensureRoot(ctx.map);
      const r = await thread(
        ctx,
        nodeId,
        typeof a.threadId === "string" ? a.threadId : undefined,
        text,
        (found) => `the user asked in a side chat on ${found.named}. ${SIDE}`,
      );
      // this move's own reply: the first of Claude's after what you asked
      // (a note the engine adds may come after it)
      const lines = r.threadId
        ? (ctx.map.threads[r.threadId]?.messages ?? [])
        : [];
      const asked = lines
        .map((l) => l.role === "you" && l.text === text)
        .lastIndexOf(true);
      const answer =
        asked >= 0
          ? lines.slice(asked + 1).find((l) => l.role === "claude")
          : undefined;
      if (!r.error && !r.stopped && answer) {
        const on =
          nodeId === ROOT
            ? "the conversation"
            : `"${ctx.map.nodes[nodeId]?.title ?? nodeId}"`;
        post(
          ofMap(ctx),
          `Side chat on ${on}. The user asked: "${text}"\nIt answered: ${answer.text}`,
        );
        writeContext(ctx.map);
        ctx.engine.push();
      }
      return r;
    },
    // a task ticked or reopened, an option taken or passed over, a question
    // settled: yours, and told to the main chat
    task(ctx, a): ActionResult {
      const id = str(a.id, 60);
      const state = str(a.state, 20) as ItemState;
      const option = own(ofMap(ctx).items, id)?.type === "option";
      const node = setTask(ofMap(ctx), ctx.map.nodes, id, state);
      if (!node) return { error: "That cannot be marked so." };
      const said = option
        ? state === "chosen"
          ? "as the one to go with"
          : state === "dropped"
            ? "as not to take"
            : "as still open"
        : state === "done"
          ? "done"
          : state === "dropped"
            ? "not to do"
            : state === "pending"
              ? "still to do"
              : state;
      ctx.note(`The user marked "${node.title}" ${said}.`);
      post(ofMap(ctx), `On the map, the user marked "${node.title}" ${said}.`);
      writeContext(ctx.map);
      ctx.engine.push();
      return { ok: true };
    },
    following(ctx, a): ActionResult {
      ofMap(ctx).following = !!a.on;
      ctx.engine.push();
      return { ok: true };
    },
    // catch up now, without waiting for the conversation to go quiet
    async sync(ctx): Promise<ActionResult> {
      readNew(ctx.map);
      const r = await catchUp(ctx.engine, ctx.map);
      return r.error ? r : { ok: true };
    },
    // draw it again from the start: everything but your ticks is filed afresh
    async redraw(ctx): Promise<ActionResult> {
      // a catch-up under way would land its ops on the wiped map and move
      // `mapped` past what the redraw files: stopped first, and outdated
      await ctx.engine.stop();
      // the stopped move's own ending runs first
      await new Promise((r) => setTimeout(r, 0));
      const s = ofMap(ctx);
      s.gen++;
      s.heldAt = 0;
      // what you ticked and what has side chats stay: a side chat is pinned
      // to its node, and would be lost with it
      const talked = new Set(
        Object.values(ctx.map.threads).map((t) => t.nodeId),
      );
      for (const id of Object.keys(ctx.map.nodes))
        if (id !== ROOT && !own(s.items, id)?.byYou && !talked.has(id))
          delete ctx.map.nodes[id];
      prune(s, ctx.map.nodes);
      // one whose topic went keeps its place under the root
      for (const n of Object.values(ctx.map.nodes))
        if (n.parent && !ctx.map.nodes[n.parent]) n.parent = ROOT;
      // the summary stays until the redraw writes its own
      s.mapped = 0;
      readNew(ctx.map);
      ctx.engine.push();
      const r = await catchUp(ctx.engine, ctx.map);
      return r.error ? r : { ok: true };
    },
  },

  unsent(map) {
    const s = chatState(map);
    const out = takeUnsent(s);
    if (!out.length) return "";
    const file = contextFile(map);
    return [
      ...out.map((o) => `- ${o.text}`),
      file ? `(Everything the map holds: ${file})` : "",
    ]
      .filter(Boolean)
      .join("\n");
  },

  readout: (map) => contextPage(map, chatState(map)),

  summary(map) {
    const s = chatState(map);
    const items = Object.values(s.items);
    const todo = items.filter(
      (i) => i.type === "task" && i.state === "pending",
    ).length;
    const topics = items.filter((i) => i.type === "topic").length;
    return `${todo} to do · ${topics} topic${topics === 1 ? "" : "s"}`;
  },

  view(map): ChatView {
    const s = chatState(map);
    prune(s, map.nodes);
    return {
      items: s.items,
      recent: s.turns.slice(-6).map((t) => ({
        ...t,
        text: t.text.length > 600 ? `${t.text.slice(0, 600)} …` : t.text,
      })),
      turns: s.turns.filter((t) => t.who === "you").length,
      mapped: s.turns.slice(0, s.mapped).filter((t) => t.who === "you").length,
      following: s.following,
      syncedAt: s.syncedAt,
      summary: s.summary,
      unsent: s.outbox.length - s.sent,
      fresh: Object.values(map.nodes)
        .filter((n) => n.fresh && Date.now() - n.updatedAt < 3 * 60_000)
        .map((n) => n.id),
    };
  },
};
