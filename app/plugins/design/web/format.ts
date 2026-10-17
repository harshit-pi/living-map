// Numbers and colours the Design screen shares.

import type { Group, Load } from "../shared.ts";

export const fmt = (n: number): string =>
  !Number.isFinite(n)
    ? "∞"
    : n >= 1e9
      ? `${+(n / 1e9).toFixed(1)}B`
      : n >= 1e6
        ? `${+(n / 1e6).toFixed(1)}M`
        : n >= 1e3
          ? `${+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`
          : String(Math.round(n));

// a component's group, as brand roles
export const GROUP_TONE: Record<
  Group,
  { fg: string; soft: string; ring: string }
> = {
  Edge: {
    fg: "text-hint-strong",
    soft: "bg-hint-soft",
    ring: "ring-hint-line",
  },
  Compute: {
    fg: "text-primary-strong",
    soft: "bg-primary-soft",
    ring: "ring-primary-line",
  },
  Data: {
    fg: "text-success-strong",
    soft: "bg-success-soft",
    ring: "ring-success-line",
  },
  Async: {
    fg: "text-warning-strong",
    soft: "bg-warning-soft",
    ring: "ring-warning-line",
  },
};

export const STATUS_TONE: Record<
  Load["status"],
  { bar: string; text: string; ring: string; label: string }
> = {
  idle: {
    bar: "bg-line",
    text: "text-faint",
    ring: "ring-line-strong",
    label: "no traffic",
  },
  ok: {
    bar: "bg-success",
    text: "text-success-strong",
    ring: "ring-line-strong",
    label: "ok",
  },
  busy: {
    bar: "bg-warning",
    text: "text-warning-strong",
    ring: "ring-warning-line",
    label: "busy",
  },
  over: {
    bar: "bg-danger",
    text: "text-danger-strong",
    ring: "ring-danger",
    label: "over capacity",
  },
  backlog: {
    bar: "bg-warning",
    text: "text-warning-strong",
    ring: "ring-warning",
    label: "backlog",
  },
};

// how far over or under capacity, short enough for a card: "70%", "3.5× cap", "7k× cap"
export const utilText = (util: number): string =>
  util > 1
    ? `${util >= 100 ? fmt(Math.round(util)) : +util.toFixed(1)}× cap`
    : `${Math.round(util * 100)}%`;
