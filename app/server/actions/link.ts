// A map of one of your own conversations, asked for from that conversation
// (the living-map skill): the map already linked to it opens again, or a new
// one starts from the question the conversation is about. Every move on it
// reads the conversation first, so what you said there needs no repeating.

import type { Purpose } from "../../shared/model.ts";
import { outline } from "../core/canvas.ts";
import { str, type StoredMap } from "../core/types.ts";
import type { Engine } from "../engine.ts";
import { modeOf, pluginFor } from "../plugins.ts";
import { findLinked } from "../store.ts";
import { message } from "./canvas.ts";
import { makeCtx } from "./context.ts";
import { cleanSettings } from "./index.ts";
import { begin, open, switchPurpose } from "./maps.ts";

export type LinkResult = {
  error?: string;
  mapId?: string;
  title?: string;
  purpose?: Purpose;
  created?: boolean; // a new map, its first move drawing now
  conversation?: string; // the linked conversation's title
};

export async function link(
  engine: Engine,
  body: Record<string, unknown>,
): Promise<LinkResult> {
  const find = engine.provider.findConversation;
  if (!find)
    return {
      error: `${engine.provider.name} cannot link a map to a conversation.`,
    };
  const conversation = find({
    id: str(body.session, 100) || undefined,
    cwd: str(body.cwd, 1000) || undefined,
  });
  if (!conversation)
    return {
      error:
        "Could not find that conversation. Pass its id as `session`, or the folder it runs in as `cwd`.",
    };
  const settings = cleanSettings(
    engine,
    body.settings && typeof body.settings === "object"
      ? (body.settings as Record<string, string>)
      : {},
  );
  const purpose = str(body.purpose, 40) || "";
  const question = str(body.question, 6000).trim();
  const say = str(body.message, 4000).trim();

  // the map already linked to this conversation, unless a new one is asked for
  const current = engine.state.map;
  const known = body.new
    ? null
    : current?.conversation?.id === conversation.id
      ? current
      : findLinked(conversation.id);
  // one in another mode it cannot switch to is not the map asked for
  const fits = (m: StoredMap) =>
    !purpose ||
    m.purpose === purpose ||
    !!pluginFor(m.purpose)?.switchesWith?.includes(purpose) ||
    !!pluginFor(purpose)?.switchesWith?.includes(m.purpose);

  if (known && fits(known)) {
    if (engine.state.map?.id !== known.id) {
      const r = await open(engine, known.id, settings);
      if (r.error) return { error: r.error };
    }
    const m = engine.state.map!;
    // the title and file move as the conversation goes on
    m.conversation = conversation;
    const ctx = makeCtx(engine, settings, m);
    if (purpose && m.purpose !== purpose) {
      const r = await switchPurpose(ctx, purpose);
      if (r.error) return { error: r.error };
    }
    const idle = !engine.state.busy && !engine.state.waiting.length;
    // left empty (the server stopped during its first move): drawn again
    if (!Object.keys(m.nodes).length && !m.diagram && idle)
      void modeOf(m.purpose)
        .start(ctx)
        .catch((e) => console.error("[link] first move failed:", e));
    // said from the conversation ("bring in what we just decided"): a move
    // on the map, drawn while the conversation goes on
    else if (say && modeOf(m.purpose).core.includes("message"))
      void message(ctx, say, []);
    engine.push();
    return reply(m, false);
  }

  if (!question)
    return {
      error:
        "This conversation has no map yet: pass `question`, one line saying what to explore or learn.",
    };
  const { map, first } = await begin(
    engine,
    settings,
    question,
    purpose || "explore",
    conversation,
  );
  void first().catch((e) => console.error("[link] first move failed:", e));
  return reply(map, true);
}

const reply = (m: StoredMap, created: boolean): LinkResult => ({
  mapId: m.id,
  title: m.title,
  purpose: m.purpose,
  created,
  conversation: m.conversation?.title ?? "",
});

// The map as text, for the conversation to read back ("what is on my map?"):
// only what the browser sees, never an answer kept on the server.
export function mapText(engine: Engine, m: StoredMap): string {
  const plugin = pluginFor(m.purpose);
  const board = plugin?.readout?.(m) ?? "";
  const said = m.chat
    .filter((c) => c.role !== "system")
    .slice(-6)
    .map((c) => `${c.role === "you" ? "You" : "Map"}: ${c.text.slice(0, 600)}`);
  return [
    `LIVING MAP: ${m.title}`,
    `Mode: ${plugin?.label ?? m.purpose}${m.conversation ? ` · linked to "${m.conversation.title}"` : ""}`,
    engine.state.busy
      ? `Working now: ${engine.state.working?.label ?? "a move"}`
      : "",
    Object.keys(m.nodes).length ? `CANVAS:\n${outline(m.nodes)}` : "",
    board,
    said.length ? `LATEST ON THE MAP:\n${said.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
