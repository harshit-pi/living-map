// Explore's controls in the header: Board or Tree, what the question is (a
// choice, finding a cause, an open question), show or hide what you set aside
// (Tree only), and Next, which says what it will do before you press it.

import {
  layingOut,
  moving,
  pluginAct,
  usePlace,
  useShowDropped,
} from "./view.ts";
import { Segmented } from "../../../web/components/Segmented.tsx";
import { setAside } from "../../../web/lib/layout.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";
import { SHAPE_WORD, SHAPES, YOURS, type Shape } from "../shared.ts";

// Board / Tree and the shape: in the header on a wide window, above the work
// on a narrower one
export function TabAndShape({ ws }: { ws: Workspace }) {
  const place = usePlace(ws.map);
  const { view, tab, board } = place;
  if (!view || layingOut(view, ws.live)) return <></>;
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
        <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted">
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

// Show or hide what you set aside, on the Tree. Kept in place on the board,
// only hidden, so Board / Tree and the rest of the header do not shift as
// you switch.
export function SetAsideToggle({
  ws,
  className = "",
}: {
  ws: Workspace;
  className?: string;
}) {
  const [showDropped, setShowDropped] = useShowDropped();
  const { tab, board } = usePlace(ws.map);
  if (tab !== "tree" && !board) return <></>;
  return (
    <label
      aria-hidden={tab !== "tree"}
      className={`items-center gap-1 whitespace-nowrap text-xs text-muted ${tab === "tree" ? "" : "invisible"} ${className}`}
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
  );
}

export function ExploreHeader({ ws }: { ws: Workspace }) {
  const place = usePlace(ws.map);
  const { view, tab, board } = place;
  const onBoard = tab === "board" && !!board;
  const gap = view ? (onBoard ? view.boards[board].next : view.next) : null;
  // Next's step is worked out from the map as it is, so while any move runs
  // or waits it may be that very move (a Fill, an Ask on the cell Next
  // names, a Choose's pre-mortem) or one it is about to change: pressing
  // would queue a second paid move. Next waits for the map to settle; a step
  // that is yours (a check to run, a must to tell) pays for nothing and
  // stays open.
  const onItsWay = !!gap && !YOURS.has(gap.kind) && moving(ws.live);
  return (
    <>
      {/* on a window narrower than xl these sit above the work
          (ExploreScreen): with them, the header ran past 1024px */}
      <div className="hidden items-center gap-2 xl:flex">
        <TabAndShape ws={ws} />
      </div>
      <SetAsideToggle ws={ws} className="hidden xl:flex" />
      <button
        disabled={onItsWay}
        onClick={() => {
          // a check Claude picked is yours to run: Next opens it, where you
          // say what it found, and pays for no move
          if (gap?.kind === "run" && gap.option) {
            place.setTab("tree");
            ws.setSelection([gap.option]);
            return;
          }
          // a must only you can settle: Next opens its want, whose thread
          // writes the whole row once you say what you know
          if (gap?.kind === "tell" && gap.want) {
            if (view?.boards[gap.q]?.shape === "choose" && gap.q !== board)
              place.openBoard(gap.q);
            ws.setSelection([gap.want]);
            return;
          }
          // a choice with its own board: Next opens it, as its chip does,
          // and that board's Next takes it from there
          if (gap?.kind === "open") {
            place.openBoard(gap.q);
            ws.setSelection([]);
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
        // one width whatever the label says, so the header never shifts;
        // narrower on a smaller window, where the header has less room
        className="flex w-[150px] min-w-0 shrink-0 items-center whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40 lg:w-[176px] xl:w-[300px]"
      >
        Next
        {/* the label at every width, cut short on a smaller window: the
            title holds the reason, and a touch screen shows no title */}
        {gap && (
          <span className="min-w-0 truncate">
            : {onItsWay ? "on its way…" : gap.label}
          </span>
        )}
        <span className="ml-auto pl-1">▸</span>
      </button>
    </>
  );
}
