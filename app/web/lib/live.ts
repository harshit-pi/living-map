import { useEffect, useState } from "react";

import type {
  MapDoc,
  ServerEvent,
  Waiting,
  Working,
} from "../../shared/model.ts";

export type Stream = { threadId: string | null; text: string };

export type Live = {
  map: MapDoc | null;
  busy: boolean;
  working: Working | null;
  queued: number;
  waiting: Waiting[];
  stream: Stream;
  online: boolean;
};

// One live connection: the server pushes the canvas after every change, what
// the model is working on, and the readable text while it writes, tagged with
// the thread it belongs to. Reconnects by itself if the server restarts.
export function useLiveMap(): Live {
  const [map, setMap] = useState<MapDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<Working | null>(null);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [stream, setStream] = useState<Stream>({ threadId: null, text: "" });
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let heard = Date.now();

    const onEvent = (ev: ServerEvent) => {
      if (ev.type === "map") {
        setMap(ev.map);
        setBusy(ev.busy);
        setWorking(ev.working);
        setWaiting(ev.waiting);
        if (!ev.busy) setStream({ threadId: null, text: "" });
      } else if (ev.type === "delta") {
        setStream((s) => ({ threadId: ev.threadId, text: s.text + ev.text }));
      } else if (ev.type === "busy") {
        setBusy(ev.busy);
        setWorking(ev.working);
        if (ev.busy) setStream({ threadId: ev.threadId, text: "" });
      }
    };

    const connect = () => {
      heard = Date.now();
      es = new EventSource("/api/events");
      es.onopen = () => setOnline(true);
      es.onerror = () => {
        setOnline(false);
        // the browser retries on its own unless the stream is closed for good
        if (es?.readyState === EventSource.CLOSED && !closed) {
          es.close();
          retry = setTimeout(connect, 1500);
        }
      };
      es.onmessage = (m) => {
        heard = Date.now();
        setOnline(true);
        onEvent(JSON.parse(m.data) as ServerEvent);
      };
    };
    connect();

    // the server pings every 10s; silence means the connection is dead even if
    // the browser has not noticed, so start a fresh one (it brings the live state)
    const watch = setInterval(() => {
      if (Date.now() - heard > 25_000) {
        setOnline(false);
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
  }, []);

  return {
    map,
    busy,
    working,
    queued: waiting.length,
    waiting,
    stream,
    online,
  };
}
