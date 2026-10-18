import dagre from "@dagrejs/dagre";
import { Fragment, useEffect, useMemo, useState } from "react";

import type {
  ArrayState,
  BoardState,
  Scene,
  Tone,
  TreeState,
} from "../../../shared/model.ts";

// One step played by hand. The same three shapes serve every subject: a board
// of cells, a row of items with pointers, a tree. Each click goes to the server,
// which checks it against the answers Claude wrote and replies at once.

const TONE: Record<Tone, string> = {
  focus: "ring-2 ring-primary ring-inset",
  attack: "bg-danger-soft/80 text-danger-strong",
  good: "bg-success-soft text-success-strong",
  bad: "bg-danger-line text-danger-strong",
  path: "bg-warning-soft text-warning-strong",
  dim: "opacity-40",
};
const toneClasses = (tones: Tone[]) => tones.map((t) => TONE[t]).join(" ");

type Pick = (key: string) => void;
type Flash = { key: string; ok: boolean } | null;

function Board({
  s,
  pick,
  flash,
}: {
  s: BoardState;
  pick?: Pick;
  flash: Flash;
}) {
  const rows = s.cells.length,
    cols = Math.max(...s.cells.map((r) => r.length), 1);
  const size = Math.max(
    40,
    Math.min(72, Math.floor(480 / Math.max(rows, cols))),
  );
  const marks = new Map<string, Tone[]>();
  for (const m of s.marks) {
    const k = `${m.at[0]},${m.at[1]}`;
    marks.set(k, [...(marks.get(k) ?? []), m.tone]);
  }
  return (
    <div
      className="inline-grid gap-0 rounded-lg bg-ink/80 p-1 shadow-md"
      style={{ gridTemplateColumns: `20px repeat(${cols}, ${size}px)` }}
    >
      <div />
      {Array.from({ length: cols }, (_, c) => (
        <div
          key={c}
          className="pb-0.5 text-center font-mono text-[10px] text-on-primary/60"
        >
          {c}
        </div>
      ))}
      {s.cells.map((row, r) => (
        <Fragment key={r}>
          <div className="flex items-center justify-center font-mono text-[10px] text-on-primary/60">
            {r}
          </div>
          {Array.from({ length: cols }, (_, c) => {
            const key = `${r},${c}`;
            const f =
              flash?.key === key
                ? flash.ok
                  ? "animate-[pop_.35s_ease-out] bg-success-line"
                  : "animate-[shake_.35s] bg-danger-line"
                : "";
            return (
              <button
                key={key}
                disabled={!pick}
                onClick={() => pick?.(key)}
                style={{ width: size, height: size }}
                className={`flex items-center justify-center text-[22px] font-semibold transition ${(r + c) % 2 ? "bg-board-dark" : "bg-board-light"} ${toneClasses(marks.get(key) ?? [])} ${pick ? "cursor-pointer hover:brightness-95" : "cursor-default"} ${f}`}
              >
                {row[c] ?? ""}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

// A row's cells are as wide as its longest item, every cell alike so the
// pointers and indexes above and below stay in line: at a fixed 64px,
// "Doncaster 50" ran into "York 40" beside it.
const cellWidth = (items: string[]) =>
  Math.min(
    168,
    Math.max(
      64,
      Math.ceil(Math.max(0, ...items.map((v) => v.length)) * 10.4) + 18,
    ),
  );

function Row({ s, pick, flash }: { s: ArrayState; pick?: Pick; flash: Flash }) {
  const marks = new Map<number, Tone[]>();
  for (const m of s.marks)
    marks.set(m.at, [...(marks.get(m.at) ?? []), m.tone]);
  const width = { width: cellWidth(s.items) };
  return (
    <div className="inline-flex flex-col items-start">
      <div className="flex">
        {s.items.map((_, i) => (
          <div
            key={i}
            style={width}
            className="flex h-9 flex-col items-center justify-end text-[11px] font-semibold text-primary-strong"
          >
            {s.pointers
              .filter((p) => p.at === i)
              .map((p) => p.name)
              .join(", ")}
            {s.pointers.some((p) => p.at === i) && <span>↓</span>}
          </div>
        ))}
      </div>
      <div className="flex overflow-hidden rounded-lg shadow-md ring-1 ring-ink/60">
        {s.items.map((v, i) => {
          const k = String(i);
          const f =
            flash?.key === k
              ? flash.ok
                ? "bg-success-line"
                : "animate-[shake_.35s] bg-danger-line"
              : "";
          return (
            <button
              key={i}
              disabled={!pick}
              onClick={() => pick?.(k)}
              style={width}
              className={`flex h-14 items-center justify-center border-r border-line-strong bg-surface px-1 text-center font-mono text-[17px] leading-tight break-words last:border-r-0 ${toneClasses(marks.get(i) ?? [])} ${pick ? "cursor-pointer hover:bg-primary-soft" : ""} ${f}`}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div className="flex">
        {s.items.map((_, i) => (
          <div
            key={i}
            style={width}
            className="pt-1 text-center font-mono text-[10px] text-faint"
          >
            {i}
          </div>
        ))}
      </div>
    </div>
  );
}

function Tree({ s, pick, flash }: { s: TreeState; pick?: Pick; flash: Flash }) {
  const laid = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB",
      nodesep: 24,
      ranksep: 44,
      marginx: 8,
      marginy: 8,
    });
    g.setDefaultEdgeLabel(() => ({}));
    const ids = new Set(s.nodes.map((n) => n.id));
    for (const n of s.nodes)
      g.setNode(n.id, {
        width: Math.max(56, n.label.length * 8 + 22),
        height: 36,
      });
    for (const n of s.nodes)
      if (n.parent && ids.has(n.parent)) g.setEdge(n.parent, n.id);
    dagre.layout(g);
    return {
      g: g.graph() as { width: number; height: number },
      pos: (id: string) => g.node(id),
      edges: g
        .edges()
        .map((e) => g.edge(e) as { points: { x: number; y: number }[] }),
    };
  }, [s.nodes]);
  const marks = new Map<string, Tone[]>();
  for (const m of s.marks)
    marks.set(m.at, [...(marks.get(m.at) ?? []), m.tone]);
  return (
    <div
      className="relative"
      style={{ width: laid.g.width, height: laid.g.height }}
    >
      <svg
        className="absolute inset-0"
        width={laid.g.width}
        height={laid.g.height}
      >
        {laid.edges.map((e, i) => (
          <path
            key={i}
            d={`M${e.points.map((p) => `${p.x},${p.y}`).join(" L")}`}
            fill="none"
            style={{ stroke: "var(--color-faint)" }}
            strokeWidth={1.5}
          />
        ))}
      </svg>
      {s.nodes.map((n) => {
        const p = laid.pos(n.id);
        if (!p) return null;
        const f =
          flash?.key === n.id.toLowerCase()
            ? flash.ok
              ? "bg-success-line"
              : "animate-[shake_.35s] bg-danger-line"
            : "";
        return (
          <button
            key={n.id}
            disabled={!pick}
            onClick={() => pick?.(n.id)}
            style={{
              left: p.x - p.width / 2,
              top: p.y - p.height / 2,
              width: p.width,
              height: p.height,
            }}
            className={`absolute flex items-center justify-center rounded-full border border-line-strong bg-surface px-2 font-mono text-[13px] shadow-xs ${toneClasses(marks.get(n.id) ?? [])} ${pick ? "cursor-pointer hover:border-primary" : ""} ${f}`}
          >
            {n.label}
          </button>
        );
      })}
    </div>
  );
}

export function ScenePlay({
  scene,
  stepTitle,
  caseLine = "",
  busy,
  building,
  onKey,
  onShow,
  onReplay,
  onHint,
  onNext,
  nextLabel = "Next step ▸",
}: {
  scene: Scene;
  stepTitle: string;
  // a build map's step case, which the scene is played on
  caseLine?: string;
  busy: boolean;
  building: boolean;
  onKey: (key: string) => Promise<{ ok?: boolean }>;
  onShow: () => void;
  onReplay: () => void;
  // a build map has no hint ladder on a scene: its hints are on the build
  onHint?: () => void;
  onNext: () => void;
  // what the finish card's main button says (a build map's play step goes
  // on to rebuild the order, not to the next step)
  nextLabel?: string;
}) {
  const [flash, setFlash] = useState<Flash>(null);
  const [text, setText] = useState("");
  // each move starts with an empty answer box
  const [atMove, setAtMove] = useState(scene.at);
  if (atMove !== scene.at) {
    setAtMove(scene.at);
    setText("");
  }
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [flash]);
  const play = async (key: string) => {
    const r = await onKey(key);
    setFlash({ key: key.toLowerCase(), ok: !!r.ok });
  };
  const t = scene.answerType;
  const pickOn = (want: Scene["answerType"]) =>
    !scene.done && t === want ? play : undefined;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col items-center px-6 pb-40 pt-5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
          Play · {stepTitle}
        </div>
        <h2 className="mt-0.5 text-center font-serif text-2xl text-ink">
          {scene.title}
        </h2>
        {caseLine && (
          <div className="mt-1 max-w-xl text-center text-[12.5px] text-muted">
            <span className="font-semibold tracking-wide text-faint uppercase">
              Case
            </span>{" "}
            · {caseLine}
          </div>
        )}
        <div className="mt-2 flex gap-1">
          {Array.from({ length: scene.total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full ${i < scene.at ? "bg-success" : i === scene.at ? "bg-primary" : "bg-line-strong"}`}
            />
          ))}
        </div>

        <div
          className={`mt-4 w-full max-w-xl rounded-xl px-4 py-3 text-center ${scene.done ? "bg-success-soft ring-1 ring-success-line" : "bg-surface shadow-xs ring-1 ring-line"}`}
        >
          {scene.done ? (
            <>
              <div className="text-[15px] font-semibold text-success-strong">
                You played it through.
              </div>
              <div className="text-xs text-success-strong">
                {scene.wrong} wrong tr{scene.wrong === 1 ? "y" : "ies"}
                {scene.shown
                  ? ` · ${scene.shown} move${scene.shown > 1 ? "s" : ""} shown`
                  : ""}
              </div>
            </>
          ) : scene.waiting ? (
            <div className="animate-pulse py-1 text-sm text-muted">
              Claude is writing the next move…
            </div>
          ) : (
            <>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-primary-strong">
                Move {scene.at + 1}
                {scene.total > scene.at + 1 ? ` of ${scene.total}` : ""}
              </div>
              <div className="text-[16px] font-medium leading-snug text-ink">
                {scene.ask}
              </div>
            </>
          )}
        </div>
        {scene.last && (
          <div
            className={`mt-2 max-w-xl text-center text-[13.5px] leading-snug ${scene.last.ok ? "text-success-strong" : "text-danger-strong"}`}
          >
            {scene.last.ok
              ? scene.last.shown
                ? `Shown: ${scene.last.key} · `
                : "✓ "
              : "✗ "}
            {scene.last.text}
          </div>
        )}

        <div className="mt-5">
          {scene.kind === "board" && (
            <Board
              s={scene.state as BoardState}
              pick={pickOn("cell")}
              flash={flash}
            />
          )}
          {scene.kind === "array" && (
            <Row
              s={scene.state as ArrayState}
              pick={pickOn("index")}
              flash={flash}
            />
          )}
          {scene.kind === "tree" && (
            <Tree
              s={scene.state as TreeState}
              pick={pickOn("node")}
              flash={flash}
            />
          )}
        </div>
        {scene.state.note && (
          <div className="mt-2 text-xs italic text-muted">
            {scene.state.note}
          </div>
        )}

        {!scene.done && !scene.waiting && scene.choices.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {scene.choices.map((c) => (
              <button
                key={c}
                onClick={() => {
                  void play(c);
                }}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium ${flash?.key === c.toLowerCase() && !flash.ok ? "animate-[shake_.35s] border-danger bg-danger-soft" : "border-line-strong bg-surface hover:border-primary hover:text-primary-strong"}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {!scene.done && !scene.waiting && t === "text" && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="type, then Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) void play(text.trim());
            }}
            className={`mt-4 w-64 rounded-lg border px-3 py-1.5 text-center outline-hidden focus:border-primary ${flash && !flash.ok ? "border-danger" : "border-line-strong"}`}
          />
        )}
        {!scene.done &&
          !scene.waiting &&
          (t === "cell" || t === "index" || t === "node") && (
            <div className="mt-2 text-[11px] text-faint">
              Click{" "}
              {t === "cell" ? "a square" : t === "index" ? "a box" : "a node"}
            </div>
          )}

        <div className="mt-5 flex gap-2">
          {scene.done ? (
            <>
              <button
                onClick={onNext}
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-strong"
              >
                {nextLabel}
              </button>
              <button
                onClick={onReplay}
                className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-body hover:bg-panel"
              >
                Play again
              </button>
            </>
          ) : (
            <>
              {onHint && (
                <button
                  onClick={onHint}
                  className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-body hover:bg-panel"
                >
                  {busy ? "Hint (after Claude)" : "Hint"}
                </button>
              )}
              <button
                onClick={onShow}
                title="Counts as shown, not worked out"
                className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-muted hover:bg-panel"
              >
                Show this move
              </button>
            </>
          )}
        </div>
        {building && (
          <div className="mt-4 animate-pulse text-sm text-muted">
            Claude is rebuilding this scene…
          </div>
        )}
      </div>
    </div>
  );
}
