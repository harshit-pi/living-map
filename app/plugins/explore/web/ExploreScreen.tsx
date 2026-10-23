import { ReactFlowProvider } from "@xyflow/react";
import { useCallback } from "react";

import { AfterChoice } from "./AfterChoice.tsx";
import { Board } from "./Board.tsx";
import { CommitSheet } from "./CommitSheet.tsx";
import { PanelActions, PanelExtra } from "./PanelParts.tsx";
import { StandLine } from "./StandLine.tsx";
import { Tree } from "./Tree.tsx";
import { Btn } from "./ui.tsx";
import {
  guardedAct,
  layingOut,
  moving,
  tagOf,
  useDecide,
  usePlace,
  useShowDropped,
  type Here,
} from "./view.ts";
import { FloatingComposer } from "../../../web/components/FloatingComposer.tsx";
import { NodePanel } from "../../../web/components/NodePanel.tsx";
import { setAside } from "../../../web/lib/layout.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import { isCheck, LAYING_OUT } from "../shared.ts";

// the room you can see in the board's pane, less its gutters
const WIDE = "calc(var(--pane-w, 100vw) - 16px - var(--cover))";

// Explore: where it stands, pinned on top; under it the board you are on
// (with a breadcrumb back up from a sub-choice) or the tree; the panel for
// the node you opened; and the main conversation at the bottom.
export function ExploreScreen({ ws }: { ws: Workspace }) {
  const [showDropped] = useShowDropped();
  const place = usePlace(ws.map);
  const { view, tab, board } = place;
  const [sheet, setSheet] = useDecide(ws.map);
  const { map, live, setSelection } = ws;
  const onTree = tab === "tree";
  // on the tree, what you selected less anything hidden with the set-aside
  // nodes: what you write is then about what you can see
  const selection =
    !onTree || showDropped
      ? ws.selection
      : ws.selection.filter((id) => !setAside(map.nodes, id));
  const one = selection.length === 1 ? map.nodes[selection[0]] : undefined;
  const busy = moving(live);
  const here: Here | null = view && {
    ws,
    view,
    busy,
    act: guardedAct(ws.run, busy),
    select: (id) => setSelection([id]),
    openBoard: place.openBoard,
    choose: (option, at) =>
      setSheet({ q: ws.map.nodes[option]?.parent ?? "", option, at }),
  };
  const shown = view && board ? view.boards[board] : undefined;
  const choices = Object.values(view?.boards ?? {}).filter(
    (b) => b.shape === "choose",
  );
  const standOn = onTree ? view?.root : board;
  // the pane's width, for what keeps to the room you can see as the board
  // scrolls sideways (the lines across the board, what is under it)
  const pane = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() =>
      el.style.setProperty("--pane-w", `${el.clientWidth}px`),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (layingOut(view, live))
    return (
      <div className="absolute inset-0 flex items-center justify-center text-muted">
        <div className="max-w-md px-4 text-center">
          <div className="animate-pulse">{live.working?.label}…</div>
          <div className="mt-3 text-sm text-faint">{live.stream.text}</div>
        </div>
      </div>
    );

  return (
    <div className="absolute inset-0 flex flex-col">
      {here && standOn && <StandLine here={here} q={standOn} />}
      <div className="relative min-h-0 flex-1">
        {onTree || !here || !shown ? (
          // a tree per map, so another map opens framed whole
          <ReactFlowProvider key={map.id}>
            <Tree
              map={map}
              showDropped={showDropped}
              selected={selection}
              workingId={live.working?.nodeId ?? null}
              busy={live.busy}
              laying={
                !!live.working &&
                Object.values(LAYING_OUT).includes(live.working.label)
              }
              panelOpen={!!one}
              onSelect={setSelection}
            />
          </ReactFlowProvider>
        ) : (
          <div
            // another board, or another map, opens at its top
            key={`${map.id}|${shown.question}`}
            ref={pane}
            // The one scroller, both ways: a board box that scrolled on its
            // own as well left the option names pinned to a box the page had
            // scrolled away. --cover is what covers the right of the pane:
            // with the panel beside it, the board scrolls in the room left,
            // on any window wide enough to leave some (the panel floats over
            // the work only on a narrow one)
            className={`absolute inset-0 overflow-auto [--cover:16px] ${one ? "md:[--cover:452px]" : ""}`}
          >
            <div className="w-max min-w-full pb-6 pl-4 pr-[var(--cover)] pt-3">
              {shown.path.length > 1 && (
                <nav
                  className="sticky left-4 mb-2 flex flex-wrap items-center gap-1 text-[13px] text-muted"
                  style={{ maxWidth: WIDE }}
                >
                  {shown.path.map((p, i) => (
                    <span key={p.id} className="flex items-center gap-1">
                      {i > 0 && <span aria-hidden>›</span>}
                      {i < shown.path.length - 1 ? (
                        <button
                          // a choice above opens its board; any other
                          // question is read on the tree
                          onClick={() =>
                            view?.boards[p.id]?.shape === "choose"
                              ? place.openBoard(p.id)
                              : place.setTab("tree")
                          }
                          className="hover:text-ink hover:underline"
                        >
                          {p.title}
                        </button>
                      ) : (
                        <span
                          className={
                            i === shown.path.length - 1 ? "text-ink" : undefined
                          }
                        >
                          {p.title}
                        </span>
                      )}
                    </span>
                  ))}
                </nav>
              )}
              {shown.shape === "choose" ? (
                <>
                  <Board key={shown.question} here={here} board={shown} />
                  <div className="sticky left-4" style={{ width: WIDE }}>
                    <AfterChoice
                      key={`after-${shown.question}`}
                      here={here}
                      board={shown}
                    />
                  </div>
                </>
              ) : (
                <div
                  className="sticky left-4 rounded-xl border border-line bg-surface p-4 text-[13.5px] text-body"
                  style={{ maxWidth: WIDE }}
                >
                  “{shown.title}” is not a choice, so it has no board to fill:
                  it shows as the tree.{" "}
                  <Btn small onClick={() => place.setTab("tree")}>
                    Show the tree
                  </Btn>
                  {/* a choice further down has a board: the way to it, or
                      this page was a dead end beside it */}
                  {choices.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="text-muted">
                        {choices.length === 1
                          ? "The choice on this map:"
                          : "The choices on this map:"}
                      </span>
                      {choices.map((c) => (
                        <Btn
                          key={c.question}
                          small
                          primary={!c.settled}
                          onClick={() => place.openBoard(c.question)}
                        >
                          {c.title} ▸
                        </Btn>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {one && (
          <NodePanel
            map={map}
            node={one}
            busy={live.busy}
            working={live.working}
            waiting={live.waiting}
            stream={live.stream}
            settings={ws.settings}
            onSettings={ws.onSettings}
            run={ws.run}
            onSelect={(id) => setSelection([id])}
            onClose={() => setSelection([])}
            actions={here ? <PanelActions here={here} node={one} /> : undefined}
            extra={here ? <PanelExtra here={here} node={one} /> : undefined}
            tag={tagOf(view, map.nodes, one, true)}
            plain
            // a check is yours to run: its box asks what it found (Next's
            // "Run the check yourself" opens it here)
            placeholder={isCheck(one) ? "What did it find?" : undefined}
          />
        )}
        {here && sheet && view?.boards[sheet.q] && (
          <CommitSheet
            key={`${sheet.q}|${sheet.option ?? ""}`}
            here={here}
            q={sheet.q}
            option={sheet.option}
            at={sheet.at}
            onClose={() => setSheet(null)}
          />
        )}
      </div>
      {/* one box at a time: an open panel has its own, for its thread */}
      {!one && (
        <FloatingComposer
          docked
          ws={{ ...ws, selection }}
          placeholder={
            selection.length
              ? "Say something about the selected nodes…"
              : // beside your chat, say where this goes: the board, not it
                map.linked
                ? "Ask about this board (your chat is not interrupted)…"
                : "Ask Claude about this…"
          }
        />
      )}
    </div>
  );
}
