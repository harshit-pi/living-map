// The conversation layer on the server: what the rail beside every view
// shows, and what you do on it: tick, pick and settle items, side chats (each
// resumes your whole conversation), switching between the views of the
// conversation, and bringing a view up to date with the chat. What you do
// here, and on any view, reaches the main chat with your next message there.

import { randomUUID } from "node:crypto";

import { post, setState, type LayerState } from "./core.ts";
import { catchUp, FOLLOWING, layerFor, readNew } from "./follow.ts";
import { LAYER } from "./prompt.ts";
import { MODES, type ItemState, type Mode } from "./shared.ts";
import { layerOf, saveLayer } from "./store.ts";
import { message } from "../server/actions/canvas.ts";
import { makeCtx, type Ctx } from "../server/actions/context.ts";
import { begin, open, switchPurpose } from "../server/actions/maps.ts";
import { own, str, type StoredMap } from "../server/core/types.ts";
import type { Engine } from "../server/engine.ts";
import { pluginFor } from "../server/plugins.ts";
import type { Conversation } from "../server/providers/types.ts";
import { linkedMaps } from "../server/store.ts";
import type { ActionResult, Settings } from "../shared/model.ts";

// ---- views ------------------------------------------------------------------------

const fits = (m: StoredMap, mode: string) =>
  m.purpose === mode ||
  !!pluginFor(m.purpose)?.switchesWith?.includes(mode) ||
  !!pluginFor(mode)?.switchesWith?.includes(m.purpose);

// Open the conversation's map in this view: the one it has, the open one
// switched (Explore and Learn share a map), or a new one drawn from the
// conversation.
export async function showView(
  engine: Engine,
  settings: Settings,
  conversation: Conversation,
  mode: Mode,
  { question = "" } = {},
): Promise<ActionResult> {
  const current = engine.state.map;
  const linked = (m: StoredMap | null) =>
    !!m?.conversation &&
    (m.conversation.id === conversation.id ||
      !!m.conversation.previous?.includes(conversation.id));
  if (current && linked(current) && current.purpose === mode) return {};
  if (current && linked(current) && fits(current, mode))
    return switchPurpose(makeCtx(engine, settings, current), mode);
  const other = linkedMaps(conversation.id).find(
    (m) => m.id !== current?.id && m.purpose === mode,
  );
  if (other) return open(engine, other.id, settings);
  const s = layerOf(conversation);
  // the question the conversation is on now, as the layer last read it: the
  // open view's title may be from long ago
  const ask = question || s.suggested?.question || conversation.title;
  const { first } = await begin(engine, settings, ask, mode, {
    ...conversation,
  });
  return first();
}

// The first map of a conversation, in the view it looks like it needs: the
// layer reads the conversation first (a catch-up), says which view fits and
// the question it is on, and that view draws from there. Until it has, the
// map waits as Explore with nothing on it (the loading screen).
export async function autoStart(
  engine: Engine,
  settings: Settings,
  conversation: Conversation,
): Promise<StoredMap> {
  const { map } = await begin(
    engine,
    settings,
    conversation.title || "This conversation",
    "explore",
    { ...conversation },
  );
  void (async () => {
    try {
      readNew(map);
      // a long conversation is read a piece per call: enough to judge it
      for (let i = 0; i < 4 && readNew(map); i++);
      await catchUp(engine, map, { label: "Reading your conversation" });
      if (engine.state.map !== map) return;
      const s = layerFor(map)!;
      const mode = s.suggested?.mode ?? "explore";
      const question = s.suggested?.question || map.title;
      map.purpose = mode;
      map.title = question;
      if (map.chat[0]?.role === "you") map.chat[0].text = question;
      engine.push();
      const r = await pluginFor(mode)!.start(makeCtx(engine, settings, map));
      if (r.error && !r.stopped) {
        map.chat.push({ role: "system", text: r.error, ts: Date.now() });
        engine.push();
      }
    } catch (e) {
      console.error("[layer] could not start the conversation's map:", e);
    }
  })();
  return map;
}

// ---- the rail's actions ------------------------------------------------------------

const layerOfCtx = (ctx: Ctx): LayerState | null => layerFor(ctx.map);

const done = (ctx: Ctx, s: LayerState): ActionResult => {
  saveLayer(s);
  ctx.engine.push();
  return { ok: true };
};

export const LAYER_ACTIONS: Record<
  string,
  (ctx: Ctx, a: Record<string, unknown>) => Promise<ActionResult> | ActionResult
> = {
  // a task ticked or reopened, an option taken or passed over, a question
  // settled: yours, and told to the main chat
  mark(ctx, a) {
    const s = layerOfCtx(ctx);
    if (!s) return { error: "This map is not linked to a conversation." };
    const id = str(a.id, 60);
    const state = str(a.state, 20) as ItemState;
    const item = setState(s, id, state);
    if (!item) return { error: "That cannot be marked so." };
    const said =
      item.type === "option"
        ? state === "chosen"
          ? "picked it as the one to go with"
          : state === "dropped"
            ? "passed on it"
            : "reopened it"
        : item.type === "question"
          ? state === "answered"
            ? "marked it settled"
            : "reopened it"
          : state === "done"
            ? "marked it done"
            : state === "dropped"
              ? "marked it not to do"
              : "marked it still to do";
    // a pick is a decision the main chat acts on; a tick can wait for you
    post(
      s,
      `On the map's rail, "${item.title}": the user ${said}.`,
      Date.now(),
      item.type === "option" || item.type === "question",
    );
    return done(ctx, s);
  },
  following(ctx, a) {
    const s = layerOfCtx(ctx);
    if (!s) return { error: "This map is not linked to a conversation." };
    s.following = !!a.on;
    delete s.pausedWhy;
    return done(ctx, s);
  },
  // catch up now, without waiting for the conversation to go quiet
  async sync(ctx) {
    const s = layerOfCtx(ctx);
    if (!s) return { error: "This map is not linked to a conversation." };
    readNew(ctx.map);
    const r = await catchUp(ctx.engine, ctx.map);
    return r.error ? r : { ok: true };
  },
  // file it all again from the start: what you set and what has side chats
  // stay
  async redraw(ctx) {
    const s = layerOfCtx(ctx);
    if (!s) return { error: "This map is not linked to a conversation." };
    // a catch-up under way would file onto the wiped rail and move `mapped`
    // past what the redraw files: stopped first, and outdated
    await ctx.engine.stop();
    await new Promise((r) => setTimeout(r, 0));
    s.gen++;
    s.heldAt = 0;
    const talked = new Set(Object.values(s.sides).map((t) => t.on));
    for (const [id, it] of Object.entries(s.items))
      if (!it.byYou && !talked.has(id)) delete s.items[id];
    for (const it of Object.values(s.items))
      if (it.parent && !s.items[it.parent]) it.parent = null;
    s.mapped = 0;
    readNew(ctx.map);
    saveLayer(s);
    ctx.engine.push();
    const r = await catchUp(ctx.engine, ctx.map, { label: FOLLOWING });
    return r.error ? r : { ok: true };
  },
  // A side chat: your whole conversation, read before the question, so it
  // answers knowing everything said there. What it answers goes to the main
  // chat with your next message there.
  async side(ctx, a) {
    const s = layerOfCtx(ctx);
    if (!s) return { error: "This map is not linked to a conversation." };
    const text = str(a.text, 4000).trim();
    if (!text) return { error: "Say something first." };
    const asked = str(a.on, 60);
    const item = asked && asked !== "root" ? own(s.items, asked) : undefined;
    const on = item ? item.id : "root";
    let t = typeof a.sideId === "string" ? own(s.sides, a.sideId) : undefined;
    if (!t) {
      const id = randomUUID().slice(0, 8);
      t = {
        id,
        on,
        title: item?.title ?? "The whole conversation",
        createdAt: Date.now(),
        lines: [],
      };
      s.sides[id] = t;
    }
    const lines = t.lines;
    lines.push({ role: "you", text, ts: Date.now() });
    saveLayer(s);
    ctx.engine.push();
    const named = item
      ? `[${item.id}] "${item.title}"`
      : "the whole conversation";
    const r = await ctx.engine.turn(
      `the user asked in a side chat on ${named}.`,
      ctx.settings,
      {
        as: LAYER,
        lines,
        scope: item ? item.id : null,
        threadId: `side:${t.id}`,
        text,
        label: "Answering on the side",
        sections: ["side"],
        view: "thread",
      },
    );
    // this move's own reply: the first of Claude's after what you asked
    const at = lines
      .map((l) => l.role === "you" && l.text === text)
      .lastIndexOf(true);
    const answer = lines.slice(at + 1).find((l) => l.role === "claude");
    if (!r.error && !r.stopped && answer)
      post(
        s,
        `Side chat on ${item ? `"${item.title}"` : "the whole conversation"}. The user asked: "${text}"\nIt answered: ${answer.text}`,
      );
    saveLayer(s);
    ctx.engine.push();
    return { ...r, threadId: t.id };
  },
  // a message to the main chat itself, from the map: it wakes a listener
  // there (or waits for your next message in it)
  tell(ctx, a) {
    const s = layerOfCtx(ctx);
    if (!s) return { error: "This map is not linked to a conversation." };
    const text = str(a.text, 4000).trim();
    if (!text) return { error: "Say something first." };
    post(s, `The user wrote to you from the map: "${text}"`, Date.now(), true);
    s.told = [...(s.told ?? []), { text, ts: Date.now() }].slice(-20);
    return done(ctx, s);
  },
  // another view of the same conversation
  async view(ctx, a) {
    const mode = str(a.mode, 20) as Mode;
    if (!MODES.includes(mode) || !ctx.map.conversation)
      return { error: "That view is not available here." };
    return showView(ctx.engine, ctx.settings, ctx.map.conversation, mode);
  },
  // bring this view up to date with what the chat said since its last move
  async refresh(ctx) {
    const plugin = pluginFor(ctx.map.purpose);
    const act = plugin?.actions?.message;
    if (!plugin?.core.includes("message") && !act)
      return { error: "This view cannot be brought up to date from here." };
    const text =
      "Bring this canvas up to date with what the conversation said since your last move: add what is new, settle what it settled, and leave the rest.";
    if (act) return act(ctx, { text });
    return message(ctx, text, []);
  },
};
