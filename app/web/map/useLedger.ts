import { useCallback, useEffect, useRef, useState } from "react";

import { applyLocal } from "./fixture.ts";
import type {
  LedgerAction,
  LedgerEvent,
  LedgerView,
} from "../../shared/ledger.ts";
import { api } from "../lib/session.ts";

export type ActResult = { ok: boolean; error?: string };

export type Ledger = {
  view: LedgerView;
  online: boolean;
  linked: boolean; // false once the server says no chat is linked any more
  act: (a: LedgerAction) => Promise<ActResult>;
};

const isView = (v: unknown): v is LedgerView =>
  !!v &&
  typeof v === "object" &&
  Array.isArray((v as LedgerView).items) &&
  typeof (v as LedgerView).conv === "string";

// The map of your chat, kept live: the server pushes the whole view on the
// shared event stream after every change, and a reconnect asks for it again
// (it may have moved on while the stream was down). In the fixture nothing
// is asked; actions apply in the page.
export function useLedger(initial: LedgerView, fixture: boolean): Ledger {
  const [view, setView] = useState(initial);
  const [online, setOnline] = useState(true);
  const [linked, setLinked] = useState(true);
  const conv = useRef(initial.conv);
  const local = useRef(initial);

  useEffect(() => {
    if (fixture) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let heard = Date.now();
    let dropped = false;

    const refetch = () =>
      api("/api/ledger/view")
        .then(async (r) => {
          if (closed) return;
          if (r.status === 404) return setLinked(false);
          if (!r.ok) return;
          const v: unknown = await r.json();
          if (isView(v)) {
            conv.current = v.conv;
            setLinked(true);
            setView(v);
          }
        })
        .catch(() => {});

    const connect = () => {
      heard = Date.now();
      es = new EventSource("/api/events");
      es.onopen = () => {
        setOnline(true);
        if (dropped) void refetch();
        dropped = false;
      };
      es.onerror = () => {
        setOnline(false);
        dropped = true;
        if (es?.readyState === EventSource.CLOSED && !closed) {
          es.close();
          retry = setTimeout(connect, 1500);
        }
      };
      es.onmessage = (m) => {
        heard = Date.now();
        setOnline(true);
        let ev: Partial<LedgerEvent>;
        try {
          ev = JSON.parse(m.data as string) as Partial<LedgerEvent>;
        } catch {
          return;
        }
        if (ev?.type !== "ledger" || !isView(ev.view)) return;
        if (ev.conv && ev.conv !== conv.current) return;
        setView(ev.view);
      };
    };
    connect();

    // the server pings every 10s: silence means a dead connection
    const watch = setInterval(() => {
      if (Date.now() - heard > 25_000) {
        setOnline(false);
        dropped = true;
        es?.close();
        connect();
      }
    }, 5000);

    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(watch);
      es?.close();
    };
  }, [fixture]);

  const act = useCallback(
    async (action: LedgerAction): Promise<ActResult> => {
      if (fixture) {
        local.current = applyLocal(local.current, action);
        setView(local.current);
        return { ok: true };
      }
      try {
        const r = await api("/api/ledger/act", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conv: conv.current, action }),
        });
        let body: unknown = null;
        try {
          body = await r.json();
        } catch {
          // an empty answer is fine: the view comes on the stream
        }
        const b = (body ?? {}) as { error?: string; view?: unknown };
        if (!r.ok)
          return { ok: false, error: b.error ?? "That didn't go through." };
        // the answer may carry the new view; else it comes on the stream
        if (isView(b.view)) setView(b.view);
        else if (isView(body)) setView(body);
        return { ok: true };
      } catch {
        return {
          ok: false,
          error: "Couldn't reach the Living Map server. Is it running?",
        };
      }
    },
    [fixture],
  );

  return { view, online, linked, act };
}
