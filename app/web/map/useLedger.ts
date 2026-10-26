import { useCallback, useEffect, useRef, useState } from "react";

import { applyLocal, localSide } from "./fixture.ts";
import type {
  LedgerAction,
  LedgerEvent,
  LedgerView,
  SideChat,
} from "../../shared/ledger.ts";
import type { ServerEvent, UpdateStep } from "../../shared/model.ts";
import { api } from "../lib/session.ts";

export type ActResult = { ok: boolean; error?: string; side?: SideChat };

export type Ledger = {
  view: LedgerView;
  // side chats seen on this page, by id: streamed on the event stream
  sides: Record<string, SideChat>;
  online: boolean;
  linked: boolean; // false once the server says no chat is linked any more
  updates: UpdateStep[]; // a one-click update's progress, step by step
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
  const [sides, setSides] = useState<Record<string, SideChat>>({});
  // a side chat's newer copy wins: the stream can run ahead of an answer
  const keepSide = useCallback((side: SideChat) => {
    setSides((all) => {
      const had = all[side.id];
      if (had && had.messages.length > side.messages.length) return all;
      return { ...all, [side.id]: side };
    });
  }, []);
  const localSides = useRef<Record<string, SideChat>>({});
  const [online, setOnline] = useState(true);
  const [linked, setLinked] = useState(true);
  const [updates, setUpdates] = useState<UpdateStep[]>([]);
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
        let ev: Partial<Extract<LedgerEvent, { type: "side" }>> &
          Partial<Extract<LedgerEvent, { type: "ledger" }>> &
          Partial<Extract<ServerEvent, { type: "update" }>>;
        try {
          ev = JSON.parse(m.data as string) as typeof ev;
        } catch {
          return;
        }
        // an update's progress, the same on every page
        if (ev?.type === "update" && typeof ev.step === "string") {
          const s: UpdateStep = {
            step: ev.step,
            state: ev.state!,
            message: ev.message,
          };
          return setUpdates((all) => [
            ...all.filter((x) => x.step !== s.step),
            s,
          ]);
        }
        if (ev.conv && ev.conv !== conv.current) return;
        if (ev?.type === "side" && ev.side && typeof ev.side.id === "string")
          return setSides((all) => ({ ...all, [ev.side!.id]: ev.side! }));
        if (ev?.type !== "ledger" || !isView(ev.view)) return;
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
        const side = localSide(local.current, localSides.current, action);
        if (side) {
          localSides.current = { ...localSides.current, [side.id]: side };
          setSides(localSides.current);
        }
        local.current = applyLocal(local.current, action, localSides.current);
        setView(local.current);
        return { ok: true, side };
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
        const b = (body ?? {}) as {
          error?: string;
          view?: unknown;
          side?: SideChat;
        };
        if (!r.ok)
          return { ok: false, error: b.error ?? "That didn't go through." };
        // the answer may carry the new view; else it comes on the stream
        if (isView(b.view)) setView(b.view);
        else if (isView(body)) setView(body);
        if (b.side && typeof b.side.id === "string") keepSide(b.side);
        return { ok: true, side: b.side };
      } catch {
        return {
          ok: false,
          error: "Couldn't reach the Living Map server. Is it running?",
        };
      }
    },
    [fixture, keepSide],
  );

  return { view, sides, online, linked, updates, act };
}
