import { ReactFlowProvider } from "@xyflow/react";

import { Canvas } from "../components/Canvas.tsx";
import { FloatingComposer } from "../components/FloatingComposer.tsx";
import { NodePanel } from "../components/NodePanel.tsx";
import type { Workspace } from "../lib/workspace.ts";

// Explore: the question as a tree of options and facts, a panel for the node
// you selected, and the main conversation at the bottom.
export function ExploreScreen({
  ws,
  showDropped,
}: {
  ws: Workspace;
  showDropped: boolean;
}) {
  const { map, live, selection, setSelection } = ws;
  const one = selection.length === 1 ? map.nodes[selection[0]] : undefined;
  return (
    <>
      <ReactFlowProvider>
        <Canvas
          map={map}
          showDropped={showDropped}
          selected={selection}
          busy={live.busy}
          workingId={live.working?.nodeId ?? null}
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
        ws={ws}
        placeholder={
          selection.length
            ? "Say something about the selected nodes…"
            : "Message Claude about the whole map…"
        }
      />
    </>
  );
}
