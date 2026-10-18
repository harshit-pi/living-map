import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getViewportForBounds,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import {
  drawn,
  labelWidth,
  looseZone,
  NODE_H,
  NODE_W,
  nothingDrawn,
  pathD,
  pathOf,
  regions,
  route,
  slotAt,
  spanOf,
  tidy,
  type At,
  type Box,
  type Drawn,
  type Region,
} from "./frame.ts";
import { MARK, WAIT_TITLE, type Here } from "./view.ts";
import {
  ARGUABLE,
  FAMILIES,
  familyOf,
  placingIsAnswer,
  type Family,
  type LinkView,
  type Mark,
  type StepView,
  type Verb,
} from "../shared.ts";

// a part dragged from the tray onto the canvas
export const PART_DRAG = "application/x-living-map-part";
// the message box covers the bottom of the canvas. Your build: below 0.5 a
// card's words are too small to read, so a bigger frame is panned rather
// than shrunk when it opens. The worked case is seen once, whole, so it may
// shrink further; and the fit button always fits the whole frame (at 0.6 a
// six-tick axis was cut off at both ends at 1440 wide, and fit could not help).
const TOP_PAD = 40;
const FIT = {
  padding: { top: `${TOP_PAD}px`, bottom: "140px", x: "6%" },
  maxZoom: 1,
  minZoom: 0.5,
} as const;
const FIT_WHOLE = { ...FIT, minZoom: 0.3 } as const;

type Tone =
  "plain" | "hidden" | "pick" | "chosen" | "found" | "extra" | "missed";
type PartData = {
  label: string;
  role: string;
  tone: Tone;
  // the part a what-if wipes out
  fails?: boolean;
  // a word on the card from the last check ("not in its lane")
  badge?: string;
  onOut?: () => void;
};
type RegionData = { label: string; loose: boolean; wide: boolean };

const SIDES = ["top", "right", "bottom", "left"] as const;
const hidden = "!h-2 !w-2 !min-w-0 !border-0 !bg-transparent";

// A part's handles and size said up front. React Flow draws a link only once
// both its parts have been measured, and a part that came in with a canvas
// already drawn (the predict's answer revealed, a step opened after Hide it)
// could stay unmeasured: its links were missing until a reload. The routed
// edge draws its own line from where the parts sit, so these only let it be
// drawn.
const HANDLES = [
  {
    id: "top",
    type: "source" as const,
    position: Position.Top,
    x: NODE_W / 2,
    y: 0,
  },
  {
    id: "right",
    type: "source" as const,
    position: Position.Right,
    x: NODE_W,
    y: NODE_H / 2,
  },
  {
    id: "bottom",
    type: "source" as const,
    position: Position.Bottom,
    x: NODE_W / 2,
    y: NODE_H,
  },
  {
    id: "left",
    type: "source" as const,
    position: Position.Left,
    x: 0,
    y: NODE_H / 2,
  },
];

function PartNode({ data }: NodeProps<Node<PartData>>) {
  const ring =
    data.tone === "pick"
      ? "ring-2 ring-primary"
      : data.tone === "chosen"
        ? "ring-2 ring-hint bg-hint-soft"
        : data.tone === "found"
          ? "ring-2 ring-success bg-success-soft"
          : data.tone === "extra"
            ? "ring-2 ring-danger bg-danger-soft"
            : data.tone === "missed"
              ? "border-2 border-dashed border-warning bg-warning-soft"
              : data.tone === "hidden"
                ? "border-2 border-dashed border-hint bg-hint-soft"
                : data.fails
                  ? "ring-2 ring-danger"
                  : "ring-1 ring-line-strong";
  return (
    <div
      className={`relative rounded-xl bg-surface px-2.5 py-1.5 shadow-xs ${ring}`}
      style={{ width: NODE_W, minHeight: NODE_H }}
      title={data.role ? `${data.label}: ${data.role}` : data.label}
    >
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={Position[(side[0].toUpperCase() + side.slice(1)) as "Top"]}
          className={hidden}
          isConnectable={false}
        />
      ))}
      <div
        className={`text-[13px] font-semibold leading-tight ${data.tone === "hidden" ? "text-center text-xl text-hint-strong" : "text-ink"}`}
      >
        {data.label}
      </div>
      {data.role && (
        <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-muted">
          {data.role}
        </div>
      )}
      {data.fails && (
        <div className="mt-0.5 text-[10.5px] font-medium text-danger-strong">
          ✕ the one that fails
        </div>
      )}
      {data.badge && (
        <div className="mt-0.5 text-[10.5px] font-medium text-warning-strong">
          {data.badge}
        </div>
      )}
      {data.onOut && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onOut!();
          }}
          title="Back to the tray"
          className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[11px] text-muted shadow-xs ring-1 ring-line-strong hover:text-ink"
        >
          ↩
        </button>
      )}
    </div>
  );
}

// nothing on screen: the room the links and their labels take, so a fit
// frames them too (a label on an arc out past the parts was cut at the
// canvas's edge)
function ExtentNode() {
  return null;
}

function RegionNode({ data }: NodeProps<Node<RegionData>>) {
  return (
    <div
      className={`h-full w-full rounded-xl ${data.loose ? "border border-dashed border-line-strong" : "bg-panel/70 ring-1 ring-line"}`}
    >
      <div
        className={`px-2.5 pt-1.5 text-[10.5px] font-semibold tracking-wide text-muted uppercase ${data.wide ? "max-w-[110px]" : "truncate"}`}
      >
        {data.label}
      </div>
    </div>
  );
}

const nodeTypes = { part: PartNode, region: RegionNode, extent: ExtentNode };

// A link drawn on the line route (frame.ts) chose, with its label where the
// route put it: React Flow's own step edges bend their own way, and a route
// costed clear could be drawn through a part. The label is drawn over every
// link's line, and a click on it opens its own link: inside the links'
// layer, a neighbour's line ran over it and took the click ("becomes ✗"
// opened "Memory B cell becomes Plasma cell").
type RoutedData = {
  path: string;
  lx: number;
  ly: number;
  // what the link takes up, its label's box included
  box: Box;
  onLabel?: (e: ReactMouseEvent) => void;
};
function RoutedEdge({
  id,
  data,
  label,
  style,
  markerEnd,
}: EdgeProps<Edge<RoutedData>>) {
  if (!data) return null;
  return (
    <>
      <BaseEdge id={id} path={data.path} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan absolute rounded-sm bg-surface px-1 text-[11px] leading-[14px] whitespace-nowrap text-body ${data.onLabel ? "cursor-pointer" : ""}`}
            style={{
              transform: `translate(-50%, -50%) translate(${data.lx}px, ${data.ly}px)`,
              pointerEvents: data.onLabel ? "all" : "none",
            }}
            onClick={(e) => {
              e.stopPropagation();
              data.onLabel?.(e);
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { routed: RoutedEdge };

const TONE: Record<Mark | "plain" | "given" | "ghost", string> = {
  right: "var(--color-success)",
  reversed: "var(--color-warning)",
  family: "var(--color-warning)",
  miscon: "var(--color-danger)",
  extra: "var(--color-faint)",
  plain: "var(--color-ink)",
  given: "var(--color-line-strong)",
  ghost: "var(--color-hint)",
};

// a given link is dashed; a ghost from the hint ladder is dotted, in the
// hint colour; a link not in Claude's model is plain grey with its "?"
const DASH: Partial<Record<keyof typeof TONE, string>> = {
  given: "5 4",
  ghost: "1.5 3.5",
};

// A link drawn the way route (frame.ts) finds cheapest to read: straight,
// or an arc round the parts in between, its label off every card and every
// other label, its line off the links drawn before it (`seen`). A run
// through another part read as linked to it ("Length mod 4 sends to Bucket
// 3"). `nth`: the how-many-th link on the same two parts. `aria`: what a
// screen reader says, in the cards' own labels (by default it read out the
// ids). `within`: the slot both ends sit in, which the link stays inside.
// `room`: the label the link is routed for, its check mark's room included
// before it is checked, so a check moves no link (a link out past the frame
// was routed afresh for "becomes ✓", reached further, and the whole canvas
// refitted as the marks came in).
function edgeOf(
  id: string,
  from: string,
  to: string,
  label: string,
  tone: keyof typeof TONE,
  at: Record<string, At>,
  nth: number,
  aria: string,
  seen: Drawn,
  within?: Box,
  room = label,
): Edge<RoutedData> {
  const r = route(from, to, at, room, nth, seen, within);
  const { pts, label: c } = pathOf(at[from], at[to], r);
  const color = TONE[tone];
  const lw = label ? labelWidth(room) / 2 : 0;
  const xs = [...pts.map((p) => p.x), c.x - lw, c.x + lw];
  const ys = [
    ...pts.map((p) => p.y),
    c.y - (label ? 9 : 0),
    c.y + (label ? 9 : 0),
  ];
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
  return {
    type: "routed",
    data: { path: pathD(pts), lx: c.x, ly: c.y, box },
    id,
    source: from,
    target: to,
    label,
    ariaLabel: aria,
    style: {
      stroke: color,
      strokeWidth: tone === "given" ? 1.4 : tone === "ghost" ? 2.2 : 1.8,
      ...(DASH[tone] ? { strokeDasharray: DASH[tone] } : {}),
    },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
  };
}

// Where a slot's own label sits, which a link's label keeps off: the top
// left of a box or column, the left of a lane (its words wrap there).
function labelMark(r: Region, frame: StepView["frame"]): Box {
  if (frame.kind === "lanes") return { x: r.x, y: r.y, w: 120, h: 46 };
  return {
    x: r.x,
    y: r.y,
    w: Math.min(r.w, r.label.length * 7 + 24),
    h: 22,
  };
}

// a popover's spot; `up`: its bottom edge, from the canvas's bottom;
// `room`: the most it may be tall and stay in the window
type Spot = At & { up?: number; room: number };
type Pop =
  | { kind: "verb"; from: string; to: string; at: Spot }
  | { kind: "link"; id: string; at: Spot }
  | { kind: "part"; id: string; at: Spot }
  | null;

export type WhatIfMode = {
  picked: string[];
  toggle: (part: string) => void;
  // the result once checked: found, extra and missed part ids
  found: string[];
  extra: string[];
  missed: string[];
  fails: string;
};

// The canvas a step is built on. `worked`: the worked case, read-only.
// `build`: your build, which you place, move and link (click a part, then
// another, then pick a verb), with the last check's marks. `done`: your
// build once it passed, read-only, where a what-if is clicked and a part
// can be gone into deeper.
export function BuildCanvas({
  here,
  st,
  mode,
  whatif,
  onDeeper,
}: {
  here: Here;
  st: StepView;
  mode: "worked" | "build" | "done";
  whatif: WhatIfMode | null;
  onDeeper: (part: string) => void;
}) {
  const { act, busy } = here;
  const rf = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  // the first part clicked, waiting for the second
  const [pick, setPick] = useState<string | null>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [argue, setArgue] = useState("");
  // where you dragged a part, until the server has it: kept only while the
  // server still has the part where it was when the drag began
  const [drag, setDrag] = useState<Record<string, { to: At; from: string }>>(
    {},
  );
  // each card's measured size, kept on the nodes: a node handed over without
  // it is hidden until React Flow measures it again
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  // a new step, or a new stage of it: nothing half-picked carries over
  const key = `${st.step}:${mode}:${st.onCase}`;
  // the canvas itself is new for a new step or the worked case, and stays
  // as it is when your build passes (remade then, its links were gone until
  // a reload)
  const canvas = `${st.step}:${mode === "worked" ? "worked" : "own"}:${st.onCase}`;
  const [keyFor, setKeyFor] = useState(key);
  if (keyFor !== key) {
    setKeyFor(key);
    setPick(null);
    setPop(null);
    setArgue("");
  }

  const frame = st.frame;
  const worked = mode === "worked" ? st.worked : null;
  const fit = worked ? FIT_WHOLE : FIT;
  const step = st.step;

  // every part of the step, placed or not: the frame is sized for them and
  // the waiting zone holds them all
  const all = worked ? worked.parts.length : st.placed.length + st.trayCount;
  // the parts on the canvas and where they are drawn
  const parts = useMemo(() => {
    if (worked) {
      const at = tidy(
        frame,
        worked.parts.map((p) => ({ id: p.id, slot: p.slot })),
        worked.links,
      );
      return worked.parts.map((p) => ({ ...p, ...at[p.id] }));
    }
    const at = drawn(
      frame,
      st.placed.map((p) => ({ ...p, id: p.id })),
      all,
    );
    return st.placed.map((p) => ({ ...p, ...at[p.id] }));
  }, [worked, frame, st.placed, all]);
  // the frame grows to hold the parts in it, where they are drawn
  const span = spanOf(
    frame,
    parts.filter((p) => "slot" in p && p.slot),
  );
  // the zone for parts outside the frame, while any wait there, and for the
  // whole build where parts start outside it (it went with the last part
  // taken out of it, and the frame was fitted afresh)
  const waiting =
    mode === "build" &&
    (st.trayCount > 0 ||
      st.help >= 2 ||
      (st.help === 1 && placingIsAnswer(frame)) ||
      st.placed.some((p) => !p.slot));
  // the worked case's hidden part has no slot (its slot would point at the
  // answer) and is drawn under the frame: the zone says why it is out there
  const hiddenOut = !!worked?.hidden;
  const zones: Region[] = useMemo(() => {
    const rs = regions(frame, span, all);
    const z = waiting
      ? looseZone(frame, span, undefined, all)
      : hiddenOut
        ? looseZone(frame, span, "The hidden part", all, 1)
        : null;
    return z ? [...rs, z] : rs;
  }, [frame, span, waiting, hiddenOut, all]);

  const count = parts.length;
  const shape = parts.map((p) => `${p.id}@${p.x},${p.y}`).join(";");
  const ready = useNodesInitialized();
  const flowW = useStore((s) => s.width);
  const flowH = useStore((s) => s.height);
  const opened = useRef("");
  const sized = useRef("");

  const rawKey = (p: { x: number; y: number; slot?: string }) =>
    `${p.x},${p.y},${p.slot ?? ""}`;
  const at: Record<string, At> = {};
  for (const p of parts) {
    const d = drag[p.id];
    const raw = st.placed.find((x) => x.id === p.id);
    at[p.id] = d && raw && d.from === rawKey(raw) ? d.to : { x: p.x, y: p.y };
  }

  const marks = new Map(st.check?.marks.map((m) => [m.link, m]) ?? []);
  const wrongSlot = new Set(
    st.check?.slots.filter((s) => !s.ok).map((s) => s.part) ?? [],
  );
  // a sort column is Claude's reading of contested evidence: the mark says
  // whose it is, as a link not in its model is never called wrong
  const word =
    frame.kind === "lanes"
      ? "not in its lane"
      : frame.kind === "boxes"
        ? "not in its box"
        : frame.kind === "sort"
          ? "Claude has it in another column"
          : "not in its column";

  const nodes: Node[] = [
    ...zones.map((r, i): Node<RegionData> => ({
      id: `zone-${i}`,
      type: "region",
      position: { x: r.x, y: r.y },
      width: r.w,
      height: r.h,
      measured: { width: r.w, height: r.h },
      style: { width: r.w, height: r.h },
      data: {
        label: r.label,
        loose: !r.slot,
        // a lane's name wraps in the room left of its parts; the strip
        // under the frame has its parts below its title, which wrapped onto
        // the first one ("NOT IN A LANE / YET")
        wide: frame.kind === "lanes" && !!r.slot,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: -1,
    })),
    ...parts.map((p): Node<PartData> => {
      const tone: Tone = worked
        ? worked.hidden === p.id
          ? "hidden"
          : "plain"
        : whatif
          ? whatif.found.includes(p.id)
            ? "found"
            : whatif.extra.includes(p.id)
              ? "extra"
              : whatif.missed.includes(p.id)
                ? "missed"
                : whatif.picked.includes(p.id)
                  ? "chosen"
                  : "plain"
          : pick === p.id
            ? "pick"
            : "plain";
      return {
        id: p.id,
        type: "part",
        position: at[p.id],
        measured: sizes[`${canvas}:${p.id}`],
        handles: HANDLES,
        initialWidth: NODE_W,
        initialHeight: NODE_H,
        draggable: mode === "build",
        data: {
          label: p.label,
          role: p.role,
          tone,
          fails: !!whatif && whatif.fails === p.label,
          badge:
            mode === "build" && wrongSlot.has(p.id)
              ? `⚠ ${word}`
              : tone === "missed"
                ? "◌ missed: affected too"
                : undefined,
          onOut:
            mode === "build" && pick === p.id && st.help >= 2
              ? () => {
                  setPick(null);
                  void act("unplace", { step, part: p.id });
                }
              : undefined,
        },
      };
    }),
  ];

  const edges: Edge<RoutedData>[] = [];
  // what is drawn so far, which each next link keeps off
  const seen = nothingDrawn(zones.map((r) => labelMark(r, frame)));
  // the slot a link's two ends both sit in, if they do
  const slotOf = (id: string) => {
    const p = at[id];
    if (!p) return undefined;
    const c = { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 };
    return zones.find(
      (r) => c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h,
    );
  };
  const withinOf = (a: string, b: string): Box | undefined => {
    const r = slotOf(a);
    return r && r === slotOf(b) ? r : undefined;
  };
  // a second link between the same two parts (yours the wrong way, a ghost
  // hint beside it) arcs out further, so each label is its own
  const pairs = new Map<string, number>();
  const nthOf = (a: string, b: string) => {
    const k = [a, b].sort().join("|");
    const n = pairs.get(k) ?? 0;
    pairs.set(k, n + 1);
    return n;
  };
  const named = (id: string) =>
    parts.find((p) => p.id === id)?.label ?? "a part";
  const link = (
    id: string,
    from: string,
    to: string,
    label: string,
    tone: keyof typeof TONE,
    rel: string,
    room = label,
  ) =>
    edges.push(
      edgeOf(
        id,
        from,
        to,
        label,
        tone,
        at,
        nthOf(from, to),
        `${named(from)} ${rel} ${named(to)}`,
        seen,
        withinOf(from, to),
        room,
      ),
    );
  if (worked)
    for (const l of worked.links)
      link(l.id, l.from, l.to, l.rel, "plain", l.rel);
  else {
    for (const l of st.links) {
      const m = marks.get(l.id);
      if (l.given) link(l.id, l.from, l.to, l.rel, "given", l.rel);
      else
        link(
          l.id,
          l.from,
          l.to,
          m ? `${l.rel} ${MARK[m.mark].sym}` : l.rel,
          m ? m.mark : "plain",
          l.rel,
          // every mark is one sign wide
          `${l.rel} ${MARK.right.sym}`,
        );
    }
    // a ghost from the hint ladder: the link drawn dashed, its verb for you
    if (mode === "build")
      for (const h of st.hints)
        if (
          h.rung === 3 &&
          h.from &&
          h.to &&
          at[h.from] &&
          at[h.to] &&
          !st.links.some((l) => l.from === h.from && l.to === h.to)
        )
          link(
            `ghost:${h.from}:${h.to}`,
            h.from,
            h.to,
            "hint: which verb?",
            "ghost",
            "a hinted link to",
          );
  }
  const spans = edges.flatMap((ed) => (ed.data ? [ed.data.box] : []));
  if (spans.length) {
    const x = Math.min(...spans.map((b) => b.x));
    const y = Math.min(...spans.map((b) => b.y));
    const w = Math.max(...spans.map((b) => b.x + b.w)) - x;
    const h = Math.max(...spans.map((b) => b.y + b.h)) - y;
    nodes.push({
      id: "extent",
      type: "extent",
      position: { x, y },
      width: w,
      height: h,
      measured: { width: w, height: h },
      data: {},
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      style: { pointerEvents: "none" },
      zIndex: -2,
    });
  }

  // A part placed out of sight brings the view round to show it, and so
  // does a layout that moved (the predict answered, the worked case redrawn
  // whole: its revealed part sat behind the side card). A canvas opened, or
  // turned from your passed build to a rebuild of it, fits its whole frame
  // (a quick rebuild opened at the passed build's zoom, a box under the side
  // card). Nothing moves while all is in view: a refit on every placement
  // moved the next drop target. It waits until the cards are measured:
  // fitView skips a card with no size, so a fit run on fresh cards (the
  // build opening from See) frames nothing. It also waits for React Flow's
  // own idea of the canvas's size, which lags a change of layout: the tray
  // opening beside a quick rebuild narrowed the canvas, the fit framed the
  // old width, and a box sat under the side card. A new size fits again.
  // where the links reach (the extent node): a link drawn out past the
  // parts brings the view round too (its label was cut at the canvas's edge
  // until Fit view)
  const extent = nodes.find((n) => n.id === "extent");
  const reach = extent
    ? `${extent.position.x},${extent.position.y},${extent.width},${extent.height}`
    : "";
  useEffect(() => {
    const el = box.current;
    if (!el || !count || !ready) return;
    if (
      Math.abs(flowW - el.clientWidth) > 2 ||
      Math.abs(flowH - el.clientHeight) > 2
    )
      return;
    const size = `${flowW}x${flowH}`;
    const resized = !!sized.current && sized.current !== size;
    sized.current = size;
    const fresh = opened.current !== `${canvas}:${mode}`;
    opened.current = `${canvas}:${mode}`;
    // A frame opened fits whole, or, too tall to fit at a readable size,
    // from its top: centred, a sort step at 1024x700 opened with its column
    // names and the parts in them above the canvas, and only the empty
    // strip under them in view.
    const fitFrame = () => {
      const ns = rf.getNodes();
      const b = rf.getNodesBounds(ns);
      const v = getViewportForBounds(
        b,
        el.clientWidth,
        el.clientHeight,
        fit.minZoom,
        fit.maxZoom,
        fit.padding,
      );
      const y = b.y * v.zoom + v.y < TOP_PAD ? TOP_PAD - b.y * v.zoom : v.y;
      void rf.setViewport({ x: v.x, y, zoom: v.zoom }, { duration: 200 });
    };
    // a window made smaller or larger leaves the parts where they were
    // drawn, off the edge or in a corner
    if (resized) {
      fitFrame();
      return;
    }
    const refit = () => {
      const { x, y, zoom } = rf.getViewport();
      const out = rf.getNodes().some((n) => {
        if (n.type === "region" && !fresh) return false;
        const w = (n.type === "part" ? NODE_W : (n.width ?? 0)) * zoom;
        const h = (n.type === "part" ? NODE_H : (n.height ?? 0)) * zoom;
        const sx = n.position.x * zoom + x;
        const sy = n.position.y * zoom + y;
        return (
          sx < -1 ||
          sy < -1 ||
          sx + w > el.clientWidth + 1 ||
          sy + h > el.clientHeight - (n.type === "part" ? 100 : 40)
        );
      });
      if (out && fresh) fitFrame();
      else if (out) void rf.fitView({ ...fit, duration: 200 });
    };
    refit();
  }, [canvas, mode, count, shape, reach, ready, rf, fit, flowW, flowH]);

  // Where a popover opens: at the click, kept inside the canvas and the
  // window; one low on the part of the canvas in view opens upward, so its
  // last row is not cut off and it stays clear of the message box. It is
  // never taller than the room it has, and scrolls inside: a link editor
  // ran 40px past the window's foot, its Argue for it out of reach.
  const where = (e: { clientX: number; clientY: number }): Spot => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return { x: 40, y: 40, room: 300 };
    const x = Math.max(8, Math.min(e.clientX - r.left, r.width - 240));
    const y = e.clientY - r.top;
    const seen = Math.min(r.height, window.innerHeight - r.top);
    return y > seen / 2
      ? { x, y, up: Math.max(8, r.height - y), room: Math.max(120, y - 8) }
      : { x, y: Math.max(8, y), room: Math.max(120, seen - y - 8) };
  };

  // Escape lets go of a part picked to link from, and closes a popover
  // (only a click on the empty canvas did)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPick(null);
      setPop(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onDrop = (e: DragEvent) => {
    const part = e.dataTransfer.getData(PART_DRAG);
    if (!part || mode !== "build") return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const spot = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
    const slot = slotAt(frame, spot, span, all);
    void act("place", {
      step,
      part,
      x: Math.round(spot.x),
      y: Math.round(spot.y),
      ...(slot ? { slot } : {}),
    });
  };

  const edgeClick = (e: { clientX: number; clientY: number }, id: string) => {
    // once it passed, a link the check marked "?" or ✗ can still be
    // argued for; nothing else on it changes
    if (mode === "done") {
      const mk = marks.get(id);
      if (mk && ARGUABLE.includes(mk.mark) && !whatif)
        setPop({ kind: "link", id, at: where(e) });
      return;
    }
    if (mode !== "build") return;
    setPick(null);
    if (id.startsWith("ghost:")) {
      const [, from, to] = id.split(":");
      return setPop({ kind: "verb", from, to, at: where(e) });
    }
    const l = st.links.find((x) => x.id === id);
    if (l && !l.given) setPop({ kind: "link", id: l.id, at: where(e) });
  };
  // a label opens its link wherever the link itself would
  for (const ed of edges) {
    const mk = marks.get(ed.id);
    const opens =
      mode === "build"
        ? !st.links.find((l) => l.id === ed.id)?.given
        : mode === "done" && !!mk && ARGUABLE.includes(mk.mark) && !whatif;
    if (opens && ed.data)
      (ed.data as RoutedData).onLabel = (e: ReactMouseEvent) =>
        edgeClick(e, ed.id);
  }

  const doTidy = () => {
    const to = tidy(
      frame,
      st.placed.map((p) => ({ id: p.id, slot: p.slot })),
      st.links,
    );
    for (const p of st.placed) {
      const t = to[p.id];
      if (t && (Math.round(t.x) !== p.x || Math.round(t.y) !== p.y))
        void act("move", {
          step,
          part: p.id,
          x: Math.round(t.x),
          y: Math.round(t.y),
        });
    }
    window.setTimeout(() => void rf.fitView({ ...fit, duration: 250 }), 400);
  };

  const popLink =
    pop?.kind === "link" ? st.links.find((l) => l.id === pop.id) : undefined;
  const popMark = popLink ? marks.get(popLink.id) : undefined;
  const popPart =
    pop?.kind === "part" ? parts.find((p) => p.id === pop.id) : undefined;

  return (
    <div
      ref={box}
      className="relative h-full min-h-0 w-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PART_DRAG)) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <ReactFlow
        // a fresh canvas per step and for the worked case, so each opens
        // framed to fit
        key={canvas}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={"loose" as never}
        // the frame is fitted to the canvas: a part dragged out of the strip
        // at its foot panned the view a little each time, and the frame
        // drifted down until a refit moved every part
        autoPanOnNodeDrag={false}
        fitView
        fitViewOptions={fit}
        minZoom={0.3}
        nodesConnectable={false}
        deleteKeyCode={null}
        onNodesChange={(changes) => {
          for (const ch of changes) {
            if (ch.type === "position" && ch.position && ch.dragging) {
              const raw = st.placed.find((x) => x.id === ch.id);
              if (raw)
                setDrag((d) => ({
                  ...d,
                  [ch.id]: { to: ch.position!, from: rawKey(raw) },
                }));
            }
            if (ch.type === "dimensions" && ch.dimensions) {
              const k = `${canvas}:${ch.id}`;
              const { width, height } = ch.dimensions;
              setSizes((s) =>
                s[k]?.width === width && s[k]?.height === height
                  ? s
                  : { ...s, [k]: { width, height } },
              );
            }
          }
        }}
        onNodeDragStop={(_, n) => {
          if (mode !== "build" || n.type !== "part") return;
          const p = {
            x: Math.round(n.position.x),
            y: Math.round(n.position.y),
          };
          const slot = slotAt(frame, p, span, all);
          // once the server has answered, the part is drawn where it says
          // (on its slot's spot): a drag that ended on the very spot it was
          // dropped on before left the server's copy unchanged, and the part
          // stayed where it was dropped, over the one beside it
          void act("move", { step, part: n.id, ...p, slot: slot ?? null }).then(
            () =>
              setDrag((d) => {
                const { [n.id]: _gone, ...rest } = d;
                return rest;
              }),
          );
        }}
        onNodeClick={(e, n) => {
          if (n.type !== "part") return;
          setPop(null);
          if (whatif) return whatif.toggle(n.id);
          if (mode === "done")
            return setPop({ kind: "part", id: n.id, at: where(e) });
          if (mode !== "build") return;
          if (!pick || pick === n.id) return setPick(pick ? null : n.id);
          setPop({ kind: "verb", from: pick, to: n.id, at: where(e) });
        }}
        onEdgeClick={(e, ed) => edgeClick(e, ed.id)}
        onPaneClick={() => {
          setPick(null);
          setPop(null);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--color-line)" />
        {/* top right, under Tidy: at the bottom they sat on the "Not in a
            box yet" strip, next to the message box */}
        <Controls
          showInteractive={false}
          fitViewOptions={FIT_WHOLE}
          position="top-right"
          style={{ marginTop: 44 }}
        />
      </ReactFlow>

      {mode === "build" && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-between gap-2 px-3">
          <div className="rounded-lg bg-surface/90 px-2.5 py-1 text-[12px] text-muted shadow-xs ring-1 ring-line">
            {pick
              ? `Now click the part “${parts.find((p) => p.id === pick)?.label ?? ""}” links to`
              : frame.kind === "free"
                ? "Click a part, then another, then pick a verb"
                : "Drag each part into its place; click a part, then another, then pick a verb"}
          </div>
          {st.placed.length > 1 && (
            <button
              onClick={doTidy}
              className="pointer-events-auto rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-[12px] text-body shadow-xs hover:border-primary"
            >
              Tidy
            </button>
          )}
        </div>
      )}

      {pop?.kind === "verb" && (
        <Popover at={pop.at} onClose={() => setPop(null)}>
          <div className="mb-1 text-[11.5px] text-muted">
            “{parts.find((p) => p.id === pop.from)?.label}” … “
            {parts.find((p) => p.id === pop.to)?.label}”
          </div>
          <VerbList
            verbs={st.verbs}
            onPick={(rel) => {
              setPop(null);
              setPick(null);
              void act("link", { step, from: pop.from, to: pop.to, rel });
            }}
          />
        </Popover>
      )}

      {pop?.kind === "link" && popLink && (
        <Popover at={pop.at} onClose={() => setPop(null)}>
          <div className="mb-1.5 text-[12px] text-body">
            “{labelOf(parts, popLink.from)}” <b>{popLink.rel}</b> “
            {labelOf(parts, popLink.to)}”
          </div>
          {popMark && (
            <div className="mb-1.5 text-[11.5px] text-muted">
              Last check: {MARK[popMark.mark].sym} {MARK[popMark.mark].word}
            </div>
          )}
          {mode === "build" && (
            <>
              <div className="mb-1.5 flex gap-1.5">
                <SmallBtn
                  onClick={() => {
                    setPop(null);
                    void act("relink", {
                      step,
                      link: popLink.id,
                      reverse: true,
                    });
                  }}
                >
                  ↔ Reverse
                </SmallBtn>
                <SmallBtn
                  onClick={() => {
                    setPop(null);
                    void act("unlink", { step, link: popLink.id });
                  }}
                >
                  Delete
                </SmallBtn>
              </div>
              <div className="mb-0.5 text-[10.5px] font-semibold tracking-wide text-faint uppercase">
                Change the verb
              </div>
              <VerbList
                verbs={st.verbs}
                current={popLink.rel}
                onPick={(rel) => {
                  setPop(null);
                  void act("relink", { step, link: popLink.id, rel });
                }}
              />
            </>
          )}
          {popMark && ARGUABLE.includes(popMark.mark) && (
            <ArgueBox
              here={here}
              mark={popMark.mark}
              link={popLink}
              text={argue}
              setText={setArgue}
              onSend={() => {
                setPop(null);
                void act("argue", { step, link: popLink.id, text: argue }).then(
                  (r) => {
                    if (!r.error) setArgue("");
                  },
                );
              }}
            />
          )}
        </Popover>
      )}

      {pop?.kind === "part" && popPart && (
        <Popover at={pop.at} onClose={() => setPop(null)}>
          <div className="text-[13px] font-semibold text-ink">
            {popPart.label}
          </div>
          {popPart.role && (
            <div className="mt-0.5 text-[12px] text-muted">{popPart.role}</div>
          )}
          <div className="mt-2">
            <SmallBtn
              disabled={busy}
              title={busy ? WAIT_TITLE : "A step of its own, under this one"}
              onClick={() => {
                setPop(null);
                onDeeper(popPart.id);
              }}
            >
              Go deeper on this part
            </SmallBtn>
          </div>
        </Popover>
      )}
    </div>
  );
}

const labelOf = (parts: { id: string; label: string }[], id: string) =>
  parts.find((p) => p.id === id)?.label ?? "";

function Popover({
  at,
  onClose,
  children,
}: {
  at: Spot;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute z-30 max-h-[calc(100%-16px)] w-[230px] overflow-y-auto rounded-xl bg-surface p-2.5 shadow-lg ring-1 ring-line"
      style={
        at.up !== undefined
          ? { left: at.x, bottom: at.up, maxHeight: at.room }
          : { left: at.x, top: at.y, maxHeight: at.room }
      }
    >
      <button
        onClick={onClose}
        className="absolute top-1 right-2 text-base leading-none text-faint hover:text-ink"
        title="Close"
      >
        ×
      </button>
      {children}
    </div>
  );
}

// the frame's verbs, by family, so a near verb sits next to the right one
export function VerbList({
  verbs,
  current,
  onPick,
}: {
  verbs: Verb[];
  current?: Verb;
  onPick: (v: Verb) => void;
}) {
  const fams = (Object.keys(FAMILIES) as Family[]).filter((f) =>
    verbs.some((v) => familyOf(v) === f),
  );
  return (
    <div className="max-h-56 space-y-1 overflow-y-auto">
      {fams.map((f) => (
        <div key={f} className="flex flex-wrap gap-1">
          {verbs
            .filter((v) => familyOf(v) === f)
            .map((v) => (
              <button
                key={v}
                onClick={() => onPick(v)}
                disabled={v === current}
                className="rounded-full border border-line-strong px-2 py-0.5 text-[12px] text-body hover:border-primary hover:text-primary-strong disabled:border-primary disabled:bg-primary-soft disabled:text-primary-strong"
              >
                {v}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

export function SmallBtn({
  children,
  onClick,
  disabled,
  title,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-2.5 py-1 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${primary ? "bg-primary text-on-primary hover:bg-primary-strong" : "border border-line-strong bg-surface text-body hover:border-primary hover:text-primary-strong"}`}
    >
      {children}
    </button>
  );
}

// Under a button that starts a paid move and is off while Claude works:
// why a press does nothing yet (a Why sent while the next step was being
// drawn looked lost), and that what you typed stays.
export function WaitNote({ here }: { here: Here }) {
  if (!here.busy) return null;
  const w = here.ws.live.working;
  return (
    <div className="text-[11.5px] leading-snug text-muted">
      Claude is busy{w ? ` (${w.label.toLowerCase()})` : ""}. This opens when it
      is done; what you typed stays.
    </div>
  );
}

// a link Claude's model does not have: say in a line why it holds
export function ArgueBox({
  here,
  link,
  text,
  setText,
  onSend,
  mark = "extra",
}: {
  here: Here;
  link: LinkView;
  // what the check marked it: not in the model, a common mix-up, or the
  // right pair with another verb
  mark?: Mark;
  text: string;
  setText: (t: string) => void;
  onSend: () => void;
}) {
  const { busy } = here;
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="text-[11.5px] text-muted">
        {mark === "miscon"
          ? "Marked as a common mix-up. Think it holds here all the same? Say why."
          : mark === "family"
            ? "Claude's model links these two with another verb. Think yours says it too? Say what you mean by it."
            : "Not in Claude's model, and not wrong. Think it holds here? Say why."}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="It holds because…"
        className="mt-1 block w-full resize-none rounded-lg border border-line-strong bg-surface px-2 py-1 text-[12.5px] outline-hidden focus:border-primary"
        aria-label={`Why ${link.rel} holds`}
      />
      <div className="mt-1 flex justify-end">
        <SmallBtn
          primary
          disabled={busy || !text.trim()}
          title={busy ? WAIT_TITLE : "One Claude move"}
          onClick={onSend}
        >
          Argue for it
        </SmallBtn>
      </div>
      <WaitNote here={here} />
    </div>
  );
}
