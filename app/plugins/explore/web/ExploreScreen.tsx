import { ReactFlowProvider } from "@xyflow/react";
import { useState } from "react";

import { AfterChoice } from "./AfterChoice.tsx";
import { Board } from "./Board.tsx";
import { CommitSheet } from "./CommitSheet.tsx";
import { TabAndShape } from "./Header.tsx";
import { PanelActions, PanelExtra } from "./PanelParts.tsx";
import { StandLine } from "./StandLine.tsx";
import { Tree } from "./Tree.tsx";
import { Btn } from "./ui.tsx";
import {
  pluginAct,
  tagOf,
  usePlace,
  useShowDropped,
  type Anchor,
  type Here,
} from "./view.ts";
import { FloatingComposer } from "../../../web/components/FloatingComposer.tsx";
import { NodePanel } from "../../../web/components/NodePanel.tsx";
import { setAside } from "../../../web/lib/layout.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";

// Explore: where it stands, pinned on top; under it the board you are on
// (with a breadcrumb back up from a sub-choice) or the tree; the panel for
// the node you opened; and the main conversation at the bottom.
export function ExploreScreen({ ws }: { ws: Workspace }) {
  const [showDropped] = useShowDropped();
  const place = usePlace(ws.map);
  const { view, tab, board } = place;
  const [sheet, setSheet] = useState<{ option: string; at: Anchor } | null>(
    null,
  );
  const { map, live, setSelection, roomy } = ws;
  const onTree = tab === "tree";
  // on the tree, what you selected less anything hidden with the set-aside
  // nodes: what you write is then about what you can see
  const selection =
    !onTree || showDropped
      ? ws.selection
      : ws.selection.filter((id) => !setAside(map.nodes, id));
  const one = selection.length === 1 ? map.nodes[selection[0]] : undefined;
  const here: Here | null = view && {
    ws,
    view,
    act: pluginAct(ws.run),
    select: (id) => setSelection([id]),
    openBoard: place.openBoard,
    choose: (option, at) => setSheet({ option, at }),
  };
  const shown = view && board ? view.boards[board] : undefined;
  const standOn = onTree ? view?.root : board;

  return (
    <div className="absolute inset-0 flex flex-col">
      {here && standOn && (
        <StandLine here={here} q={standOn} onBoard={!onTree} />
      )}
      {view && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-1.5 lg:hidden">
          <TabAndShape ws={ws} />
        </div>
      )}
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
              panelOpen={!!one}
              onSelect={setSelection}
            />
          </ReactFlowProvider>
        ) : (
          <div
            // another board, or another map, opens at its top
            key={`${map.id}|${shown.question}`}
            className="absolute inset-0 overflow-y-auto px-4 pb-56 pt-3"
            // with the panel beside it, the board scrolls in the room left
            style={one && roomy ? { paddingRight: 452 } : undefined}
          >
            {shown.path.length > 1 && (
              <nav className="mb-2 flex flex-wrap items-center gap-1 text-[13px] text-muted">
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
                <AfterChoice
                  key={`after-${shown.question}`}
                  here={here}
                  board={shown}
                />
              </>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-4 text-[13.5px] text-body">
                “{shown.title}” is not a choice, so it has no board to fill: it
                shows as the tree.{" "}
                <Btn small onClick={() => place.setTab("tree")}>
                  Show the tree
                </Btn>
              </div>
            )}
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
            tag={tagOf(view, map.nodes, one)}
          />
        )}
        {/* on a narrow window the panel covers the work, and has its own box
            for its thread: the main one would run under it */}
        {(!one || roomy) && (
          <FloatingComposer
            ws={{ ...ws, selection }}
            placeholder={
              selection.length
                ? "Say something about the selected nodes…"
                : onTree
                  ? "Message Claude about the whole map…"
                  : "Message Claude about the board…"
            }
          />
        )}
        {here && sheet && (
          <CommitSheet
            key={sheet.option}
            here={here}
            option={sheet.option}
            at={sheet.at}
            onClose={() => setSheet(null)}
          />
        )}
      </div>
    </div>
  );
}
