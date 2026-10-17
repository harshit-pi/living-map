import { ReactFlowProvider } from "@xyflow/react";

import { useShowDropped } from "./view.ts";
import { Canvas } from "../../../web/components/Canvas.tsx";
import { FloatingComposer } from "../../../web/components/FloatingComposer.tsx";
import { NodePanel } from "../../../web/components/NodePanel.tsx";
import { setAside } from "../../../web/lib/layout.ts";
import type { Workspace } from "../../../web/lib/workspace.ts";

// Explore: the question as a tree of options and facts, a panel for the node
// you selected, and the main conversation at the bottom.
export function ExploreScreen({ ws }: { ws: Workspace }) {
  const [showDropped] = useShowDropped();
  const { map, live, setSelection } = ws;
  // what you selected, less anything hidden with the set-aside nodes: what you
  // write is then about what you can see
  const selection = showDropped
    ? ws.selection
    : ws.selection.filter((id) => !setAside(map.nodes, id));
  // a node hidden with the set-aside ones takes its panel with it
  const one =
    selection.length === 1 &&
    (showDropped || !setAside(map.nodes, selection[0]))
      ? map.nodes[selection[0]]
      : undefined;
  return (
    <>
      {/* a canvas per map, so another map opens framed whole */}
      <ReactFlowProvider key={map.id}>
        <Canvas
          map={map}
          showDropped={showDropped}
          selected={selection}
          busy={live.busy}
          workingId={live.working?.nodeId ?? null}
          panelOpen={!!one}
          onSelect={setSelection}
        />
      </ReactFlowProvider>
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
        />
      )}
      <FloatingComposer
        ws={{ ...ws, selection }}
        placeholder={
          selection.length
            ? "Say something about the selected nodes…"
            : "Message Claude about the whole map…"
        }
      />
    </>
  );
}
