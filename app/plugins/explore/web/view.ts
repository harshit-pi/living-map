// Explore's view state, shared by its header controls and its screen: the tab
// (Board or Tree), the board you are on, whether set-aside nodes show in the
// Tree, and the row groups you opened. None of it is on the server: the
// board you are on is yours to move between, and Next and the stand line are
// told it when they need it.

import { useSyncExternalStore } from "react";

import type { Action, ActionResult, MapDoc } from "../../../shared/model.ts";
import { store, stored } from "../../../web/lib/storage.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import { PLUGIN_ID, type ExploreView, type Weight } from "../shared.ts";

export type Tab = "board" | "tree";

type Ui = {
  // the tab and board belong to one map; another map starts on its default
  mapId: string | null;
  tab: Tab | null;
  board: string | null;
  showDropped: boolean;
  // the groups you opened, by `${mapId}|${question}`, kept in localStorage
  opened: Record<string, Weight[]>;
};

let ui: Ui = {
  mapId: null,
  tab: null,
  board: null,
  showDropped: true,
  opened: stored<Record<string, Weight[]>>("explore.opened", {}),
};
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
function set(next: Partial<Ui>) {
  ui = { ...ui, ...next };
  for (const cb of listeners) cb();
}

const useUi = () => useSyncExternalStore(subscribe, () => ui);

// The board's view, as the server sent it; null on a map Learn has open.
export const exploreView = (map: MapDoc): ExploreView | null =>
  (map.data?.[PLUGIN_ID] as ExploreView | undefined) ?? null;

// The tab and board you are on, worked out from the view: a board that has
// gone, or another map's, falls back to the root, and the tab to what the root
// is (a choice opens on the board, anything else on the tree).
export function usePlace(map: MapDoc) {
  const u = useUi();
  const view = exploreView(map);
  const mine = u.mapId === map.id;
  const root = view?.root ?? null;
  const board =
    mine && u.board && view?.boards[u.board]
      ? u.board
      : root && view?.boards[root]
        ? root
        : null;
  const tab: Tab =
    !view || !board ? "tree" : mine && u.tab ? u.tab : view.defaultView;
  return {
    view,
    tab,
    // the question the board tab shows (the root by default)
    board,
    setTab: (t: Tab) => set({ mapId: map.id, tab: t, board }),
    // open a question's board
    openBoard: (q: string) => set({ mapId: map.id, tab: "board", board: q }),
  };
}

export function useShowDropped(): [boolean, (v: boolean) => void] {
  const u = useUi();
  return [u.showDropped, (v) => set({ showDropped: v })];
}

// The row groups you opened on one board; your choice is kept per board.
export function useOpened(
  mapId: string,
  q: string,
): [Set<Weight>, (w: Weight, open: boolean) => void] {
  const u = useUi();
  const k = `${mapId}|${q}`;
  return [
    new Set(u.opened[k] ?? []),
    (w, open) => {
      const cur = new Set(u.opened[k] ?? []);
      if (open) cur.add(w);
      else cur.delete(w);
      const opened = { ...ui.opened, [k]: [...cur] };
      store("explore.opened", opened);
      set({ opened });
    },
  ];
}

// One of Explore's own actions, sent as the plugin's.
export const pluginAct =
  (run: (a: Action) => Promise<ActionResult>) =>
  (name: string, args: Record<string, unknown> = {}) =>
    run({ type: "plugin", plugin: PLUGIN_ID, name, args });

// Where a popover opens: the box of what was clicked, and the window's size
// then, read in the click (never during render).
export type Anchor = {
  left: number;
  top: number;
  bottom: number;
  vw: number;
  vh: number;
};
export function anchorOf(el: Element): Anchor {
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    bottom: r.bottom,
    vw: window.innerWidth,
    vh: window.innerHeight,
  };
}

// A cause is not an option you pick: several can be true, and marking one
// likely is not a choice. Its card and panel say so (set aside keeps the
// usual word).
export function tagOf(
  view: ExploreView | null,
  nodes: MapDoc["nodes"],
  n: MapDoc["nodes"][string],
): string | undefined {
  if (!view || n.kind !== "option" || !n.parent) return undefined;
  if (n.dropped || n.status === "dropped") return undefined;
  const shape =
    view.boards[n.parent]?.shape ??
    view.questions.find((p) => p.id === n.parent)?.shape;
  if (shape !== "causes" || nodes[n.parent]?.kind !== "question")
    return undefined;
  return n.status === "chosen" ? "✓ marked likely" : "possible cause";
}

// What the board's parts work with.
export type Here = {
  ws: Workspace;
  view: ExploreView;
  act: (name: string, args?: Record<string, unknown>) => Promise<ActionResult>;
  // NodePanel on a node
  select: (id: string) => void;
  openBoard: (q: string) => void;
  // the Choose… sheet for an option, anchored on what opened it
  choose: (option: string, at: Anchor) => void;
};
