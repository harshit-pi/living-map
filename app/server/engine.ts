// One move at a time: build what the model is sent, stream its reply onto the
// canvas as ops complete, and keep every open tab in step. The engine knows the
// model only through the ModelProvider interface.
//
//   action ──► queue ──► message (canvas + thread + action) ──► provider
//                                                                  │ streams
//   tabs ◄── events ◄── canvas ◄── ops as they complete ◄──────────┘

import { randomUUID } from "node:crypto";

import { DEBUG, HISTORY } from "./config.ts";
import type {
  ActionResult,
  ChatLine,
  MapDoc,
  ServerEvent,
  Settings,
  View,
  Waiting,
  Working,
} from "../shared/model.ts";
import { applyOps, outline, pathTo } from "./core/canvas.ts";
import { diagramOutline } from "./core/diagram.ts";
import { systemPrompt, viewLine, type Section } from "./core/prompts.ts";
import {
  completeOps,
  hasMapBlock,
  unreadableOps,
  visiblePart,
} from "./core/reply.ts";
import { sceneOutline, sceneView } from "./core/scene.ts";
import type { Raw, StoredMap } from "./core/types.ts";
import type { Hub } from "./events.ts";
import { pluginFor } from "./plugins.ts";
import type {
  ModelCall,
  ModelProvider,
  ModelUsage,
} from "./providers/types.ts";

export type TurnOptions = {
  text?: string;
  selection?: string[];
  threadId?: string | null; // the side thread the reply goes to (none: the main conversation)
  label?: string; // what the working bar says
  nodeId?: string | null; // the node the move is about, for the panel's working state
  blankId?: string | null; // a blank being checked, cleared if the check never comes back
  judge?: boolean; // in a thread, may still fill the topic diagram's blanks
  view?: View;
  // the instructions this move needs beyond the canvas's job (see prompts.ts)
  sections?: readonly Section[];
  keep?: boolean; // may add and change nodes, never remove one
  // what the working bar says once the move's ops show what it is doing
  // (null: keep the label): the first move's label is a guess from the
  // question's words until the model frames it
  relabel?: (m: StoredMap) => string | null;
};

export type Engine = ReturnType<typeof createEngine>;

export type Save = (m: StoredMap, opts?: { current?: boolean }) => void;

export function createEngine({
  provider,
  hub,
  initial,
  save,
}: {
  provider: ModelProvider;
  hub: Hub;
  initial: StoredMap | null;
  save: Save; // where maps are kept (the store on disk; a stub in tests)
}) {
  const state = {
    map: initial,
    busy: false,
    working: null as Working | null,
    waiting: [] as Waiting[],
  };
  let call: ModelCall | null = null;
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0; // bumped by Stop, New and Open: whatever is waiting is cancelled

  // What the browser sees: everything but notes, and scenes without their answers.
  const publicMap = (m: StoredMap | null): MapDoc | null =>
    m && {
      id: m.id,
      title: m.title,
      purpose: m.purpose,
      nodes: m.nodes,
      chat: m.chat,
      threads: m.threads,
      diagram: m.diagram,
      diagramAt: m.diagramAt,
      fills: m.fills,
      usage: m.usage,
      scenes: Object.fromEntries(
        Object.entries(m.scenes).map(([id, sc]) => [
          id,
          sceneView(sc, m.play[id]),
        ]),
      ),
      ...(pluginFor(m.purpose)?.view
        ? { data: { [m.purpose]: pluginFor(m.purpose)!.view!(m) } }
        : {}),
    };

  const snapshot = (): ServerEvent => ({
    type: "map",
    map: publicMap(state.map),
    busy: state.busy,
    working: state.working,
    queued: state.waiting.length,
    waiting: state.waiting,
  });

  function push() {
    if (state.map) save(state.map);
    hub.emit(snapshot());
  }

  // The main conversation is map.chat; side threads live in map.threads.
  const threadOf = (
    m: StoredMap,
    threadId: string | null | undefined,
  ): ChatLine[] =>
    threadId && m.threads[threadId] ? m.threads[threadId].messages : m.chat;

  function openThread(m: StoredMap, nodeId: string): string {
    const id = randomUUID().slice(0, 8);
    const count = Object.values(m.threads).filter(
      (t) => t.nodeId === nodeId,
    ).length;
    m.threads[id] = {
      id,
      nodeId,
      title: count ? `Fork ${count + 1}` : "Thread",
      createdAt: Date.now(),
      messages: [],
    };
    return id;
  }

  // Everything the model is sent for one move. Stateless: the canvas and the
  // one thread this move belongs to, nothing else.
  function message(
    m: StoredMap,
    action: string,
    opts: TurnOptions,
    scope: string | null,
    history: ChatLine[],
    notes: string[],
  ) {
    const sceneId = scope ?? opts.nodeId;
    const plugin = pluginFor(m.purpose);
    return [
      `CANVAS (${plugin ? (plugin.canvasName ?? `${plugin.label.toLowerCase()} canvas`) : "learning path"}):\n${outline(m.nodes)}`,
      plugin?.outline?.(m) ?? "",
      m.purpose === "learn"
        ? `TOPIC DIAGRAM:\n${diagramOutline(m.diagram, m.fills, m.answers)}`
        : "",
      scope
        ? `THIS THREAD IS PINNED TO [${scope}]. Path from the root: ${pathTo(
            m.nodes,
            scope,
          )
            .map((n) => `"${n.title}"`)
            .join(" → ")}. Stay on this node.`
        : "",
      history.length
        ? `THIS THREAD SO FAR:\n${history.map((h) => `${h.role === "you" ? "USER" : h.role === "claude" ? "YOU" : "NOTE"}: ${h.text.slice(0, 1200)}`).join("\n")}`
        : "",
      notes.length
        ? `WHAT THE USER DID ON THE CANVAS SINCE YOUR LAST REPLY:\n${notes.map((n) => `- ${n}`).join("\n")}`
        : "",
      sceneId && m.scenes[sceneId]
        ? sceneOutline(m.scenes[sceneId], m.play[sceneId])
        : "",
      m.source
        ? `THE MATERIAL THE USER PASTED AT THE START (the full problem or text):\n${m.source}`
        : "",
      `ACTION: ${action}`,
      opts.selection?.length
        ? `SELECTED NODES: ${opts.selection.map((id) => `[${id}] ${m.nodes[id]?.title ?? id}`).join("; ")}`
        : "",
      opts.text ? `USER SAYS: ${opts.text}` : "",
      viewLine(opts.view ?? "visual"),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  function recordUsage(
    m: StoredMap,
    u: ModelUsage | null,
    firstMs: number,
    endMs: number,
  ) {
    if (!u) return;
    m.usage.turns++;
    m.usage.input += u.input;
    m.usage.output += u.output;
    m.usage.costUsd += u.costUsd;
    m.usage.last = {
      input: u.input,
      output: u.output,
      costUsd: u.costUsd,
      ms: endMs,
      firstMs,
      model: u.model,
      effort: u.effort,
    };
    if (m === state.map) push();
    else save(m, { current: false });
  }

  async function run(
    action: string,
    settings: Settings,
    opts: TurnOptions,
  ): Promise<ActionResult> {
    const m = state.map;
    if (!m) return { error: "Start first." };
    const threadId = opts.threadId ?? null;
    const thread = threadId ? m.threads[threadId] : null;
    const scope = thread?.nodeId ?? null;
    // ops core does not know go to the map's plugin
    const plugin = pluginFor(m.purpose);
    // a side thread may change only what its node allows: an op the plugin
    // refused there is said under the reply, which may still name it as made
    let refused = 0;
    const opExtra = plugin?.applyOp
      ? (op: Raw) => {
          const n = plugin.applyOp!(m, op, { scope });
          if (n === 0 && scope) refused++;
          return n;
        }
      : undefined;
    state.busy = true;
    stopped = false;
    state.working = {
      label: opts.label ?? "Thinking",
      nodeId: opts.nodeId ?? scope,
      threadId,
      blankId: opts.blankId ?? null,
      since: Date.now(),
    };
    hub.emit({ type: "busy", busy: true, threadId, working: state.working });

    const messages = threadOf(m, threadId);
    const notes = m.notes.splice(0);
    let shown = "";
    let applied = 0;
    let lastPush = 0;
    try {
      // the thread so far, without the message this move is answering (it is
      // sent as USER SAYS); replies to earlier queued messages stay in
      const earlier = [...messages];
      const own = opts.text
        ? earlier
            .map((h) => h.role === "you" && h.text === opts.text)
            .lastIndexOf(true)
        : -1;
      if (own >= 0) earlier.splice(own, 1);
      const text = message(
        m,
        action,
        opts,
        scope,
        earlier.slice(-HISTORY),
        notes,
      );
      for (const n of Object.values(m.nodes)) delete n.fresh;
      call = provider.run(
        {
          system: systemPrompt(
            m.purpose,
            opts.sections ?? [],
            pluginFor(m.purpose),
          ),
          message: text,
          ...settings,
        },
        (soFar) => {
          const visible = visiblePart(soFar);
          if (visible.length > shown.length) {
            hub.emit({
              type: "delta",
              text: visible.slice(shown.length),
              threadId,
            });
            shown = visible;
          }
          const ops = completeOps(soFar);
          if (ops.length > applied) {
            try {
              applyOps(m, ops.slice(applied), {
                scope,
                judge: opts.judge,
                extra: opExtra,
                keep: opts.keep,
                keepYours: plugin?.keepUserNodes,
              });
            } catch (e) {
              console.error("[move] an op could not be applied:", e);
            }
            applied = ops.length;
            const label = opts.relabel?.(m);
            if (label && state.working) state.working.label = label;
            const now = Date.now();
            if (now - lastPush > 120) {
              lastPush = now;
              push();
            }
          }
        },
      );
      const reply = await call.reply;
      if (stopped) {
        messages.push({ role: "system", text: "Stopped.", ts: Date.now() });
        m.notes.unshift(...notes);
        return { stopped: true };
      }
      if (DEBUG)
        console.log(
          "[move]",
          JSON.stringify({
            ok: reply.ok,
            final: reply.final.slice(0, 400),
            applied,
          }),
        );
      if (!reply.ok) {
        messages.push({
          role: "system",
          text: `Claude did not answer (${reply.error}). Try again.`,
          ts: Date.now(),
        });
        m.notes.unshift(...notes);
        return {};
      }
      const ops = completeOps(reply.final);
      if (ops.length > applied)
        applyOps(m, ops.slice(applied), {
          scope,
          judge: opts.judge,
          extra: opExtra,
          keep: opts.keep,
          keepYours: plugin?.keepUserNodes,
        });
      // say so when some of the model's changes could not be read, rather than
      // dropping them silently
      const broken = unreadableOps(reply.final);
      if (broken)
        messages.push({
          role: "system",
          text: `${broken} of Claude's changes could not be read. Try again.`,
          ts: Date.now(),
        });
      const view = opts.view ?? "visual";
      if (!hasMapBlock(reply.final) && view === "visual")
        messages.push({
          role: "system",
          text: "Claude replied without changing the canvas.",
          ts: Date.now(),
        });
      messages.push({
        role: "claude",
        text: visiblePart(reply.final).trim() || "(updated the canvas)",
        ts: Date.now(),
        view,
        ...(opts.blankId ? { blankId: opts.blankId } : {}),
        ...(opts.nodeId && !threadId ? { nodeId: opts.nodeId } : {}),
      });
      if (refused)
        messages.push({
          role: "system",
          text:
            refused === 1
              ? "1 of Claude's changes was not made: it reaches past what this side thread may change."
              : `${refused} of Claude's changes were not made: they reach past what this side thread may change.`,
          ts: Date.now(),
        });
      void reply.usage.then((u) =>
        recordUsage(m, u, reply.firstMs, reply.endMs),
      );
      return {};
    } finally {
      call = null;
      state.busy = false;
      state.working = null;
      // whatever scene this move was writing is now as long as it will get
      for (const sc of Object.values(m.scenes))
        if (sc.complete === false) sc.complete = true;
      // a check that never came back (stopped, failed) must not leave its blank stuck on "checking"
      if (opts.blankId && m.fills[opts.blankId]?.state === "pending")
        delete m.fills[opts.blankId];
      push();
    }
  }

  // Moves run one at a time. Anything asked while the model is busy waits its
  // turn instead of being refused, so nothing you type is lost.
  function turn(
    action: string,
    settings: Settings,
    opts: TurnOptions = {},
  ): Promise<ActionResult> {
    const gen = generation;
    const forMap = state.map;
    const ticket: Waiting = {
      label: opts.label ?? "Thinking",
      nodeId: opts.nodeId ?? null,
    };
    state.waiting.push(ticket);
    if (state.busy) push();
    const next = queue.then(async (): Promise<ActionResult> => {
      state.waiting = state.waiting.filter((t) => t !== ticket);
      if (gen !== generation || state.map !== forMap) {
        if (opts.blankId && forMap?.fills[opts.blankId]?.state === "pending")
          delete forMap.fills[opts.blankId];
        // say so where it was asked, so it does not look sent and unanswered
        if (forMap) {
          threadOf(forMap, opts.threadId).push({
            role: "system",
            text: "Cancelled before Claude saw it.",
            ts: Date.now(),
          });
          if (forMap === state.map) push();
          else save(forMap, { current: false });
        }
        return { stopped: true };
      }
      return run(action, settings, opts);
    });
    queue = next.catch(() => {});
    return next;
  }

  // End the running move (what streamed so far stays on the canvas) and cancel what waits.
  async function stop() {
    generation++;
    state.waiting = [];
    if (!state.busy) return;
    stopped = true;
    call?.cancel();
    for (let i = 0; i < 50 && state.busy; i++)
      await new Promise((r) => setTimeout(r, 100));
  }

  const isQueuedOrRunning = (nodeId: string | null, label: string) =>
    (state.working?.nodeId === nodeId && state.working.label === label) ||
    state.waiting.some((t) => t.nodeId === nodeId && t.label === label);

  return {
    state,
    provider,
    push,
    snapshot,
    turn,
    stop,
    threadOf,
    openThread,
    isQueuedOrRunning,
  };
}
