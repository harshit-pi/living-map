// Explore's controls in the header: Next, which says in a few words what it
// will do (its reason on hover), and one ⋯ beside it for the rest: Board or
// Tree, what the question is (a choice, finding a cause, an open question),
// what is still open, the facts no cell uses yet, and whether the Tree shows
// what you set aside.

import {
  anchorOf,
  layingOut,
  moving,
  pluginAct,
  useDecide,
  usePlace,
  useShowDropped,
} from "./view.ts";
import {
  More,
  type MoreItem,
  type MoreSection,
} from "../../../web/components/More.tsx";
import { setAside } from "../../../web/lib/layout.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import { SHAPE_WORD, SHAPES, YOURS } from "../shared.ts";

// Everything in the header's ⋯, worked out from where you are
function useMoreSections(ws: Workspace): MoreSection[] {
  const place = usePlace(ws.map);
  const [showDropped, setShowDropped] = useShowDropped();
  const { view, tab, board } = place;
  if (!view || layingOut(view, ws.live)) return [];
  const onTree = tab === "tree";
  const q = !onTree && board ? board : view.root;
  const shape = q
    ? (view.boards[q]?.shape ?? view.questions.find((p) => p.id === q)?.shape)
    : undefined;
  // an open item opens its board, or, for a question that is not a choice,
  // its node on the tree
  const goTo = (id: string) => {
    if (view.boards[id]?.shape === "choose") {
      place.openBoard(id);
      ws.setSelection([]);
    } else {
      place.setTab("tree");
      ws.setSelection([id]);
    }
  };
  // Board or Tree only where there is a board to fill: a cause list or an
  // open question reads on the tree
  const view1: MoreItem[] =
    board && view.boards[board].shape === "choose"
      ? [
          {
            label: onTree ? "Show as board" : "Show as tree",
            onClick: () => place.setTab(onTree ? "board" : "tree"),
          },
        ]
      : [];
  if (onTree)
    view1.push({
      label: "Show set-aside",
      on: showDropped,
      title: "Show what you set aside on the tree, faded",
      onClick: () => {
        setShowDropped(!showDropped);
        // a node hidden with the set-aside ones leaves the selection, so
        // what you write is about what you can see
        if (showDropped)
          ws.setSelection((s) => s.filter((id) => !setAside(ws.map.nodes, id)));
      },
    });
  const loose = !onTree && board ? view.boards[board].looseFacts : [];
  return [
    { items: view1 },
    {
      head: "This is a…",
      fold: true,
      items:
        q && shape
          ? SHAPES.map((s) => ({
              label: SHAPE_WORD[s],
              on: s === shape,
              title:
                "What kind of question this is; Claude will not change it once you set it",
              onClick: () => {
                if (s === shape) return;
                void pluginAct(ws.run)("shape", { q, shape: s });
                // a choice shows as a board, anything else as the tree
                place.setTab(s === "choose" ? "board" : "tree");
              },
            }))
          : [],
    },
    {
      head: `Still open (${view.open.length})`,
      fold: true,
      items: view.open.map((o) => ({
        label: o.label,
        onClick: () => goTo(o.q),
      })),
    },
    {
      head: `Facts not used yet (${loose.length})`,
      fold: true,
      items: loose.map((f) => ({
        label: f.title,
        content: true,
        title: "A fact on this choice that backs no cell yet",
        onClick: () => ws.setSelection([f.id]),
      })),
    },
  ];
}

export function ExploreHeader({ ws }: { ws: Workspace }) {
  const place = usePlace(ws.map);
  const [decide, setDecide] = useDecide(ws.map);
  const sections = useMoreSections(ws);
  const { view, tab, board } = place;
  const onBoard = tab === "board" && !!board;
  const gap = view ? (onBoard ? view.boards[board].next : view.next) : null;
  // Next's step is worked out from the map as it is, so while any move runs
  // or waits it may be that very move (a Fill, an Ask on the cell Next
  // names, a Choose's pre-mortem) or one it is about to change: pressing
  // would queue a second paid move. Next waits for the map to settle; a step
  // that is yours (a check to run, a must to tell, deciding) pays for
  // nothing and stays open.
  const onItsWay = !!gap && !YOURS.has(gap.kind) && moving(ws.live);
  // an open panel or the Decide sheet owns the screen's one filled button
  const owned =
    !!decide || (ws.selection.length === 1 && !!ws.map.nodes[ws.selection[0]]);
  const text = gap ? (gap.short ?? gap.label) : "Next";
  return (
    <>
      <button
        data-primary={owned ? undefined : true}
        disabled={onItsWay}
        onClick={(e) => {
          // deciding is yours: the sheet opens under Next, nothing picked
          if (gap?.kind === "choose") {
            if (gap.q !== board) place.openBoard(gap.q);
            ws.setSelection([]);
            setDecide({
              q: gap.q,
              option: null,
              at: anchorOf(e.currentTarget),
            });
            return;
          }
          // a check Claude picked is yours to run: Next opens it, where you
          // say what it found, and pays for no move
          if (gap?.kind === "run" && gap.option) {
            place.setTab("tree");
            ws.setSelection([gap.option]);
            return;
          }
          // a must only you can settle: Next opens its want, whose thread
          // writes the whole row once you say what you know; when the cells
          // wait on a check still to run, the check it names, where you
          // answer it
          if (gap?.kind === "tell" && (gap.check || gap.want)) {
            if (view?.boards[gap.q]?.shape === "choose" && gap.q !== board)
              place.openBoard(gap.q);
            ws.setSelection([gap.check ?? gap.want!]);
            return;
          }
          // a choice with its own board: Next opens it, as its chip does,
          // and that board's Next takes it from there
          if (gap?.kind === "open") {
            place.openBoard(gap.q);
            ws.setSelection([]);
            return;
          }
          // Claude leads a cause surely: Next opens it, whose panel marks
          // it likely
          if (gap?.kind === "likely" && gap.option) {
            place.setTab("tree");
            ws.setSelection([gap.option]);
            return;
          }
          // Claude agrees with the cause you marked likely: Next opens the
          // question, whose panel settles it
          if (gap?.kind === "settle") {
            place.setTab("tree");
            ws.setSelection([gap.q]);
            return;
          }
          if (!view) {
            void ws.run({ type: "next" });
            return;
          }
          void pluginAct(ws.run)("next", { q: onBoard ? board : null });
          // the gap is on another choice: go to its board, where it is filled
          if (
            onBoard &&
            gap &&
            gap.q !== board &&
            view.boards[gap.q]?.shape === "choose"
          )
            place.openBoard(gap.q);
        }}
        title={
          onItsWay
            ? "Claude is working: Next picks its step once the map settles"
            : gap
              ? `${gap.label}: ${gap.reason}`
              : "Claude takes the next step"
        }
        // the label in a few words, cut short on a small window: the title
        // holds the whole step and its reason, and a touch screen shows no
        // title
        className={`flex min-w-0 max-w-[150px] shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40 lg:max-w-[220px] xl:max-w-[300px] ${owned ? "border border-line-strong bg-surface text-body hover:border-primary" : "bg-primary text-on-primary hover:bg-primary-strong"}`}
      >
        {/* the words only: a ▸ at its edge read as a menu caret, and a
            click on it to see the other steps started a paid move */}
        <span className="min-w-0 truncate">
          {onItsWay ? "On its way…" : text}
        </span>
      </button>
      <More sections={sections} />
    </>
  );
}
