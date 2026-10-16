// Server-sent events to every open tab, with a heartbeat so a page can tell a
// quiet server from a gone one and reconnect.

import type { Response } from "express";

import type { ServerEvent } from "../shared/model.ts";

export type Hub = {
  add: (res: Response, first: ServerEvent) => void;
  remove: (res: Response) => void;
  emit: (event: ServerEvent) => void;
};

export function createHub(heartbeatMs = 10_000): Hub {
  const clients = new Set<Response>();
  const write = (res: Response, event: ServerEvent) =>
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  const hub: Hub = {
    add(res, first) {
      clients.add(res);
      write(res, first);
    },
    remove(res) {
      clients.delete(res);
    },
    emit(event) {
      for (const res of clients) write(res, event);
    },
  };
  setInterval(() => hub.emit({ type: "ping" }), heartbeatMs).unref();
  return hub;
}
