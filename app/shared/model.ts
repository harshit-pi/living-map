// What the server pushes on its event stream and the one-click update's
// shapes: both sides import this file, so the two can never drift apart. The
// map of a chat itself is shared/ledger.ts.

import type { LedgerEvent } from "./ledger.ts";

export type UpdateInfo = {
  current: { version: string; sha: string };
  latest: {
    version: string;
    notes: string;
    url: string;
    publishedAt: string;
  } | null;
  available: boolean; // the latest release is ahead of what runs here
  behind: number; // commits between here and the latest release
  canUpdate: boolean;
  reason: string; // why an update cannot run here, if it cannot
  restarts: boolean; // the launcher restarts the app after an update
};
export type UpdateStep = {
  step: string;
  state: "running" | "done" | "failed";
  message?: string;
};

export type ServerEvent =
  | { type: "ping" }
  | ({ type: "update" } & UpdateStep)
  // the map of a chat changed (shared/ledger.ts)
  | LedgerEvent;
