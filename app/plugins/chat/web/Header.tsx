import { viewOf } from "./view.ts";
import { More } from "../../../web/components/More.tsx";
import type { Workspace } from "../../../web/lib/workspace.ts";
import { PLUGIN_ID } from "../shared.ts";

// Following on or off, catching up now, and drawing the map again from the
// start (your ticks stay).
export function ChatHeader({ ws }: { ws: Workspace }) {
  const view = viewOf(ws.map);
  if (!view) return <></>;
  const run = (name: string, args?: Record<string, unknown>) =>
    void ws.run({ type: "plugin", plugin: PLUGIN_ID, name, args });
  const busy = ws.live.busy || ws.live.waiting.length > 0;
  return (
    <More
      sections={[
        {
          items: [
            {
              label: "Catch up now",
              title:
                "File what the chat said since the last update, without waiting",
              disabled: busy || view.turns <= view.mapped,
              onClick: () => run("sync"),
            },
            {
              label: view.following ? "Pause following" : "Follow the chat",
              onClick: () => run("following", { on: !view.following }),
            },
            {
              label: "Draw it again",
              title:
                "File the whole conversation afresh; what you ticked stays",
              disabled: busy,
              onClick: () => run("redraw"),
            },
          ],
        },
      ]}
    />
  );
}
