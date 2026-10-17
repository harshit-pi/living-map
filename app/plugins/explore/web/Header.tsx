// Explore's controls in the header: Board or Tree, what the question is (a
// choice, finding a cause, an open question), show or hide what you set aside
// (Tree only), and Next, which says what it will do before you press it.

import { pluginAct, usePlace, useShowDropped } from "./view.ts";
import { Segmented } from "../../../web/components/Segmented.tsx";
import { setAside } from "../../../web/lib/layout.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import { SHAPE_WORD, SHAPES, type Shape } from "../shared.ts";

// Board / Tree and the shape: in the header on a wide window, above the work
// on a narrower one
export function TabAndShape({ ws }: { ws: Workspace }) {
  const place = usePlace(ws.map);
  const { view, tab, board } = place;
  if (!view) return <></>;
  const q = tab === "board" && board ? board : view.root;
  const shape = q
    ? (view.boards[q]?.shape ?? view.questions.find((p) => p.id === q)?.shape)
    : undefined;
  return (
    <>
      {board && (
        <Segmented
          value={tab}
          options={[
            ["board", "Board"],
            ["tree", "Tree"],
          ]}
          onChange={place.setTab}
        />
      )}
      {q && shape && (
        <label className="flex items-center gap-1 text-xs text-muted">
          This is:
          <select
            value={shape}
            onChange={(e) => {
              void pluginAct(ws.run)("shape", {
                q,
                shape: e.target.value as Shape,
              });
              // a choice shows as a board, anything else as the tree
              place.setTab(e.target.value === "choose" ? "board" : "tree");
            }}
            title="What kind of question this is; Claude will not change it once you set it"
            className="cursor-pointer rounded-md border-0 bg-transparent py-0.5 pl-1 pr-6 text-xs text-ink hover:bg-panel"
          >
            {SHAPES.map((s) => (
              <option key={s} value={s}>
                {SHAPE_WORD[s]}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

export function ExploreHeader({ ws }: { ws: Workspace }) {
  const [showDropped, setShowDropped] = useShowDropped();
  const place = usePlace(ws.map);
  const { view, tab, board } = place;
  const onBoard = tab === "board" && !!board;
  const gap = view ? (onBoard ? view.boards[board].next : view.next) : null;
  return (
    <>
      <div className="hidden items-center gap-2 lg:flex">
        <TabAndShape ws={ws} />
      </div>
      {/* kept in place on the board, only hidden, so Board / Tree and the
          rest of the header do not shift as you switch */}
      {(tab === "tree" || board) && (
        <label
          aria-hidden={tab !== "tree"}
          className={`hidden items-center gap-1 text-xs text-muted lg:flex ${tab === "tree" ? "" : "invisible"}`}
        >
          <input
            type="checkbox"
            disabled={tab !== "tree"}
            checked={showDropped}
            onChange={(e) => {
              setShowDropped(e.target.checked);
              // a node hidden with the set-aside ones leaves the selection, so
              // what you write is about what you can see
              if (!e.target.checked)
                ws.setSelection((s) =>
                  s.filter((id) => !setAside(ws.map.nodes, id)),
                );
            }}
          />{" "}
          Set aside
        </label>
      )}
      <button
        onClick={() => {
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
          gap ? `${gap.label}: ${gap.reason}` : "Claude takes the next step"
        }
        // one width whatever the label says, so the header never shifts
        className="flex min-w-0 shrink-0 items-center whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40 xl:w-[300px]"
      >
        Next
        {/* the label on a wide window; its reason is in the title */}
        {gap && (
          <span className="hidden min-w-0 truncate xl:inline">
            : {gap.label}
          </span>
        )}
        <span className="ml-auto pl-1">▸</span>
      </button>
    </>
  );
}
