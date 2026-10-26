import { lazy, Suspense, useState, type ReactNode } from "react";

import { Chats } from "./Chats.tsx";
import { Mark } from "./components/Logo.tsx";
import { useSignedIn } from "./lib/session.ts";
import { useLedgerProbe, wantedConv, wantsFixture } from "./map/probe.ts";

// the map of your chat, loaded once the server has one for this page
const MapScreen = lazy(() => import("./map/MapScreen.tsx"));

// Not signed in (the page was opened without the skill's one-time link):
// nothing of your chats is shown, only how to open it. Signed in, /?conv=<chat>
// is that chat's map and the bare address lists every chat with one.
// ?fixture=1 draws the fixture map; a dev build lets it past the sign-in, so
// the page can be worked on with no server behind it.
export default function App() {
  const signedIn = useSignedIn();
  const [fixture] = useState(wantsFixture);
  const [conv] = useState(wantedConv);
  const open = signedIn || (fixture && import.meta.env.DEV);
  if (!open && signedIn === false)
    return (
      <Notice title="Open Living Map from Claude Code">
        Say <code>/living-map</code> in your Claude Code chat. It opens this
        page signed in, with the map of that chat. To have it here too, choose ⋯
        → <b>Open in your browser</b> on that map.
      </Notice>
    );
  if (!open) return <div className="h-full bg-canvas" />;
  if (!conv && !fixture) return <Chats />;
  return <Chooser conv={conv} fixture={fixture} />;
}

function Chooser({ conv, fixture }: { conv: string; fixture: boolean }) {
  const probe = useLedgerProbe(fixture, conv);
  const blank = <div className="h-full bg-canvas" />;
  if (probe === null) return blank;
  if (probe === "none")
    return (
      <Notice title="This chat has no map">
        Say <code>/living-map</code> in that Claude Code chat: its map draws
        here as you talk. <a href="/">Your other maps</a>
      </Notice>
    );
  return (
    <Suspense fallback={blank}>
      <MapScreen initial={probe.view} fixture={probe.fixture} />
    </Suspense>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas px-6">
      <div className="max-w-sm text-center">
        <Mark size={40} className="mx-auto" />
        <h1 className="mt-4 text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-body [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </p>
      </div>
    </div>
  );
}
