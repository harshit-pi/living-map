// Playable scenes: one step of a learning path, played move by move on a
// generic board, array or tree. The model writes the scene once, answers
// included; the answers stay on the server, which checks each click instantly.
// Nothing here is specific to one problem: every scene is data for the same
// three shapes.

import {
  list,
  str,
  type Answer,
  type Move,
  type Play,
  type Raw,
  type SceneData,
} from "./types.ts";
import type { Scene, SceneKind, SceneState, Tone } from "../../shared/model.ts";

export const SCENE_KINDS = new Set<SceneKind>(["board", "array", "tree"]);
const TONES = new Set<Tone>(["focus", "attack", "good", "bad", "path", "dim"]);

// Answers compare as plain keys: "r,c" for a cell, "i" for an index, a node id,
// or normalised text for a choice or a typed answer.
export const normKey = (k: unknown): string =>
  String(k ?? "")
    .toLowerCase()
    .replace(/[\s"'`.]/g, "")
    .replace(/[,;]+/g, ",");

function cleanState(kind: SceneKind, raw: Raw): SceneState {
  const s = raw && typeof raw === "object" ? raw : {};
  const tone = (t: unknown): Tone =>
    TONES.has(t as Tone) ? (t as Tone) : "focus";
  const marks = list(s.marks, 40);
  const note = str(s.note, 120);
  if (kind === "board")
    return {
      cells: list(s.cells, 10).map((r) =>
        list(r, 10).map((c) => str(String(c ?? ""), 6)),
      ),
      marks: marks.map((m) => ({
        at: list(m?.at, 2).map(Number) as [number, number],
        tone: tone(m?.tone),
      })),
      note,
    };
  if (kind === "array")
    return {
      items: list(s.items, 16).map((c) => str(String(c ?? ""), 12)),
      pointers: list(s.pointers, 6).map((p) => ({
        name: str(p?.name, 10),
        at: Number(p?.at),
      })),
      marks: marks.map((m) => ({ at: Number(m?.at), tone: tone(m?.tone) })),
      note,
    };
  return {
    nodes: list(s.nodes, 24).map((n) => ({
      id: str(String(n?.id ?? ""), 30),
      label: str(String(n?.label ?? ""), 30),
      parent: n?.parent == null ? null : str(String(n.parent), 30),
    })),
    marks: marks.map((m) => ({
      at: str(String(m?.at ?? ""), 40),
      tone: tone(m?.tone),
    })),
    note,
  };
}

function cleanAnswer(raw: Raw): Answer | null {
  const a = raw && typeof raw === "object" ? raw : {};
  if (Array.isArray(a.cell))
    return { type: "cell", keys: [a.cell.slice(0, 2).join(",")] };
  if (Array.isArray(a.cells))
    return {
      type: "cell",
      keys: list(a.cells, 20)
        .map((c) => (Array.isArray(c) ? c.slice(0, 2).join(",") : ""))
        .filter(Boolean),
    };
  if (a.index != null)
    return { type: "index", keys: [String(Number(a.index))] };
  if (Array.isArray(a.indexes))
    return {
      type: "index",
      keys: a.indexes.map((i: unknown) => String(Number(i))),
    };
  if (a.node != null) return { type: "node", keys: [normKey(a.node)] };
  if (a.choice != null) return { type: "choice", keys: [normKey(a.choice)] };
  if (a.text != null)
    return {
      type: "text",
      keys: list(Array.isArray(a.text) ? a.text : [a.text], 8).map(normKey),
    };
  return null;
}

export function cleanMove(
  kind: SceneKind,
  m: Raw,
  prev: SceneState,
): Move | null {
  const answer = cleanAnswer(m?.answer);
  if (!answer) return null;
  const wrong: Record<string, string> = {};
  for (const [k, v] of Object.entries(m?.wrong ?? {}).slice(0, 12))
    wrong[normKey(k)] = str(String(v ?? ""), 140);
  return {
    ask: str(m?.ask, 160),
    answer,
    why: str(m?.why, 200),
    wrong,
    choices: list(m?.choices, 4)
      .map((c) => str(String(c ?? ""), 40))
      .filter(Boolean),
    // a move without "then" keeps the picture as it was
    then:
      m?.then && typeof m.then === "object" ? cleanState(kind, m.then) : prev,
  };
}

// A scene may come whole, or as a header followed by one "move" op per move
// while the model writes; then it is playable from its first move.
export function cleanScene(spec: Raw): SceneData | null {
  if (!spec || !SCENE_KINDS.has(spec.kind)) return null;
  const kind = spec.kind as SceneKind;
  const start = cleanState(kind, spec.start);
  const moves: Move[] = [];
  for (const m of list(spec.moves, 12)) {
    const mv = cleanMove(
      kind,
      m,
      moves.length ? moves[moves.length - 1].then : start,
    );
    if (mv) moves.push(mv);
  }
  return {
    kind,
    title: str(spec.title, 90),
    start,
    moves,
    complete: moves.length > 0 && Array.isArray(spec.moves),
  };
}

export function addMove(scene: SceneData | undefined, m: Raw): boolean {
  if (!scene || scene.moves.length >= 12) return false;
  const mv = cleanMove(
    scene.kind,
    m,
    scene.moves.length ? scene.moves[scene.moves.length - 1].then : scene.start,
  );
  if (mv) scene.moves.push(mv);
  return !!mv;
}

export const newPlay = (): Play => ({
  at: 0,
  wrong: 0,
  tries: 0,
  shown: 0,
  misses: [],
  last: null,
});

// Check one move. Returns the new play record; never touches the scene.
export function playMove(scene: SceneData, play: Play, key: string): Play {
  const p = { ...play, misses: [...play.misses] };
  const move = scene.moves[p.at];
  if (!move) return p;
  const k = normKey(key);
  p.tries++;
  if (move.answer.keys.includes(k)) {
    p.at++;
    p.last = { ok: true, text: move.why };
  } else {
    p.wrong++;
    p.misses.push(`move ${p.at + 1}: ${key}`);
    p.last = {
      ok: false,
      text:
        move.wrong[k] ||
        "Not that one. Look at what the board already tells you.",
    };
  }
  return p;
}

export function showMove(scene: SceneData, play: Play): Play {
  const move = scene.moves[play.at];
  if (!move) return play;
  return {
    ...play,
    at: play.at + 1,
    shown: play.shown + 1,
    last: { ok: true, shown: true, key: move.answer.keys[0], text: move.why },
  };
}

// What the browser gets: the board as it stands and the question in front of
// you, never the answers.
export function sceneView(scene: SceneData, play: Play = newPlay()): Scene {
  const done = scene.complete !== false && play.at >= scene.moves.length;
  const move = scene.moves[play.at];
  return {
    kind: scene.kind,
    title: scene.title,
    total: scene.moves.length,
    at: play.at,
    done,
    waiting: !done && !move, // the model is still writing the next move
    state: play.at === 0 ? scene.start : scene.moves[play.at - 1].then,
    ask: move?.ask ?? "",
    choices: move?.choices ?? [],
    answerType: move?.answer.type ?? null,
    last: play.last,
    wrong: play.wrong,
    shown: play.shown,
  };
}

// The scene as the model reads it back when you ask for help on that step.
export function sceneOutline(scene: SceneData, play: Play = newPlay()): string {
  const move = scene.moves[play.at];
  const lines = [
    `SCENE (${scene.kind}) "${scene.title}": the learner is on move ${Math.min(play.at + 1, scene.moves.length)} of ${scene.moves.length}${play.at >= scene.moves.length ? " (finished)" : ""}.`,
  ];
  if (move)
    lines.push(
      `Current move asks: "${move.ask}". Its answer (do not reveal unless SHOW ANSWER): ${move.answer.keys.join(" or ")}.`,
    );
  if (play.misses.length)
    lines.push(
      `Their wrong tries so far: ${play.misses.slice(-6).join("; ")}.`,
    );
  if (play.shown) lines.push(`${play.shown} move(s) were shown to them.`);
  return lines.join("\n");
}
