import { useEffect, useState } from "react";

import type { LedgerView } from "../../shared/ledger.ts";
import { api } from "../lib/session.ts";

// Does the server have a map of your chat for this page? Asked once: a view
// (200) opens the new map, anything else keeps the page as it was. With
// ?fixture=1 the page draws the fixture instead and asks nothing
// (?fixture=empty, reading or error for its other states).
export type Probe = null | "none" | { view: LedgerView; fixture: boolean };

export const wantsFixture = () =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("fixture");

// the chat this page is the map of (/?conv=<chat>); none means the list
export const wantedConv = () =>
  typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("conv") ?? "")
    : "";

export const viewUrl = (conv: string) =>
  `/api/ledger/view${conv ? `?conv=${encodeURIComponent(conv)}` : ""}`;

export function useLedgerProbe(fixture: boolean, conv: string): Probe {
  const [probe, setProbe] = useState<Probe>(null);
  useEffect(() => {
    let live = true;
    const done = (p: Probe) => {
      if (live) setProbe(p);
    };
    if (fixture)
      void import("./fixture.ts").then((f) =>
        done({
          view: f.fixtureView(
            new URLSearchParams(window.location.search).get("fixture") ?? "",
          ),
          fixture: true,
        }),
      );
    else
      api(viewUrl(conv))
        .then(async (r) =>
          done(
            r.ok
              ? { view: (await r.json()) as LedgerView, fixture: false }
              : "none",
          ),
        )
        .catch(() => done("none"));
    return () => {
      live = false;
    };
  }, [fixture, conv]);
  return probe;
}
