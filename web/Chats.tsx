import { useEffect, useState } from "react";

import { Mark } from "./components/Logo.tsx";
import { api } from "./lib/session.ts";
import type { ChatSummary } from "../shared/ledger.ts";

// Every chat with a map, for a browser already signed in that opens the bare
// address: each opens in its own tab, at its own address (/?conv=<chat>).
// Asked again when you come back to this tab, since a chat may have been
// linked meanwhile.
export function Chats() {
  const [chats, setChats] = useState<ChatSummary[] | "error" | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () =>
      api("/api/ledger/chats")
        .then(async (r) => {
          if (!live) return;
          setChats(r.ok ? ((await r.json()) as ChatSummary[]) : "error");
        })
        .catch(() => {
          if (live) setChats("error");
        });
    ask();
    window.addEventListener("focus", ask);
    return () => {
      live = false;
      window.removeEventListener("focus", ask);
    };
  }, []);

  return (
    <div className="min-h-full bg-canvas px-4 py-10">
      <div className="mx-auto max-w-lg">
        <Mark size={36} />
        <h1 className="mt-4 text-lg font-semibold text-ink">Your maps</h1>
        <p className="mt-1 text-sm text-body">
          One for each chat you said <code>/living-map</code> in. Each opens in
          a new tab.
        </p>
        {chats === "error" && (
          <p className="mt-6 text-sm text-warning-strong">
            Couldn&apos;t reach the Living Map server. Is it running?
          </p>
        )}
        {Array.isArray(chats) && chats.length === 0 && (
          <p className="mt-6 text-sm text-muted">
            No chat is linked yet. Say <code>/living-map</code> in a Claude Code
            chat and it appears here.
          </p>
        )}
        {Array.isArray(chats) && chats.length > 0 && (
          <ul className="mt-6 space-y-2">
            {chats.map((c) => (
              <li key={c.conv}>
                <a
                  href={`/?conv=${encodeURIComponent(c.conv)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl bg-surface px-4 py-3 ring-1 ring-line hover:bg-panel"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      data-content
                      className="min-w-0 truncate text-[15px] font-medium text-ink"
                    >
                      {c.title || "Untitled chat"}
                    </span>
                    {c.waiting > 0 && (
                      <span className="shrink-0 text-xs font-medium text-primary-strong">
                        {c.waiting} waiting on you
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex gap-2 truncate text-xs text-muted">
                    <span className="truncate" title={c.cwd}>
                      {folderOf(c.cwd)}
                    </span>
                    <span>·</span>
                    <span className="shrink-0">
                      {c.turns} turn{c.turns === 1 ? "" : "s"}
                    </span>
                    <span>·</span>
                    <span className="shrink-0">linked {ago(c.linkedAt)}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const folderOf = (cwd: string) =>
  cwd.replace(/\/+$/, "").split("/").pop() || cwd || "no folder";

// how long ago, in the coarsest unit that is not zero
function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
