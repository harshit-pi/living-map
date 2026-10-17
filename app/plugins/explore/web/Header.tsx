import { useShowDropped } from "./view.ts";
import { setAside } from "../../../web/lib/layout.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";

// Explore's controls in the header: show or hide what you set aside, and Next
export function ExploreHeader({ ws }: { ws: Workspace }) {
  const [showDropped, setShowDropped] = useShowDropped();
  return (
    <>
      <label className="flex items-center gap-1 text-xs text-muted">
        <input
          type="checkbox"
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
      <button
        onClick={() => {
          void ws.run({ type: "next" });
        }}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-strong disabled:opacity-40"
      >
        Next ▸
      </button>
    </>
  );
}
