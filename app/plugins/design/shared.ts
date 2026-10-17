// Design: you build a system's high-level design from typed components; a
// rough load check runs as you wire it, and Claude reviews it against a
// reference design it keeps to itself. Shared by the plugin's server and screen.

export const PLUGIN_ID = "design";

export type KindId =
  | "client"
  | "dns"
  | "cdn"
  | "lb"
  | "gateway"
  | "ratelimiter"
  | "service"
  | "worker"
  | "cache"
  | "sql"
  | "nosql"
  | "blob"
  | "search"
  | "queue"
  | "stream"
  | "notify"
  | "warehouse"
  | "external";

export type Group = "Edge" | "Compute" | "Data" | "Async";

// What a component does with traffic, as rules of thumb, not benchmarks.
// cap* are operations per second for one instance (or one shard of a store);
// pass* is the share of reads or writes it sends on (a cache sends only its
// misses); a router splits traffic across its outgoing arrows, everything
// else calls each of them.
export type KindSpec = {
  label: string;
  group: Group;
  hint: string;
  icon: string; // SVG path data, 24x24, stroked
  capRead: number;
  capWrite: number;
  passRead: number;
  passWrite: number;
  router?: boolean;
  source?: boolean;
  store?: boolean;
  async?: boolean;
  // stores scale reads with replicas and both with shards; others with instances
  shards?: boolean;
};

const INF = Number.POSITIVE_INFINITY;

export const KINDS: Record<KindId, KindSpec> = {
  client: {
    label: "Client",
    group: "Edge",
    hint: "app or browser; where traffic starts",
    icon: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
    capRead: INF,
    capWrite: INF,
    passRead: 1,
    passWrite: 1,
    source: true,
  },
  dns: {
    label: "DNS",
    group: "Edge",
    hint: "turns a name into an address; carries no requests",
    icon: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
    capRead: INF,
    capWrite: INF,
    passRead: 0,
    passWrite: 0,
  },
  cdn: {
    label: "CDN",
    group: "Edge",
    hint: "serves files from near the user; ~90% of reads never reach you",
    icon: "M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 10.5 3.75 3.75 0 0 0 7 18z",
    capRead: INF,
    capWrite: INF,
    passRead: 0.1,
    passWrite: 1,
  },
  lb: {
    label: "Load balancer",
    group: "Edge",
    hint: "spreads requests across the servers behind it",
    icon: "M12 3v6M12 9l-6 6M12 9l6 6M6 15v5M18 15v5M12 9v11",
    capRead: 200_000,
    capWrite: 200_000,
    passRead: 1,
    passWrite: 1,
    router: true,
  },
  gateway: {
    label: "API gateway",
    group: "Edge",
    hint: "one front door; routes each API call to its service",
    icon: "M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6z",
    capRead: 100_000,
    capWrite: 100_000,
    passRead: 1,
    passWrite: 1,
    router: true,
  },
  ratelimiter: {
    label: "Rate limiter",
    group: "Edge",
    hint: "turns away callers that send too much",
    icon: "M4 16a8 8 0 1 1 16 0M12 16l4-5",
    capRead: 500_000,
    capWrite: 500_000,
    passRead: 1,
    passWrite: 1,
  },
  service: {
    label: "Service",
    group: "Compute",
    hint: "your code; one instance handles ~5k requests/s",
    icon: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
    capRead: 5_000,
    capWrite: 5_000,
    passRead: 1,
    passWrite: 1,
  },
  worker: {
    label: "Worker",
    group: "Compute",
    hint: "does background jobs taken from a queue",
    icon: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
    capRead: 2_000,
    capWrite: 2_000,
    passRead: 1,
    passWrite: 1,
  },
  cache: {
    label: "Cache",
    group: "Data",
    hint: "keeps hot data in memory; ~90% of reads stop here",
    icon: "M13 2L4 14h7l-1 8 9-12h-7z",
    capRead: 100_000,
    capWrite: 100_000,
    passRead: 0.1,
    passWrite: 1,
    store: true,
    shards: true,
  },
  sql: {
    label: "SQL database",
    group: "Data",
    hint: "tables and transactions; replicas add reads, only shards add writes",
    icon: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    capRead: 10_000,
    capWrite: 3_000,
    passRead: 1,
    passWrite: 1,
    store: true,
    shards: true,
  },
  nosql: {
    label: "NoSQL store",
    group: "Data",
    hint: "key-value or wide-column; shards spread reads and writes",
    icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    capRead: 50_000,
    capWrite: 20_000,
    passRead: 1,
    passWrite: 1,
    store: true,
    shards: true,
  },
  blob: {
    label: "Object storage",
    group: "Data",
    hint: "photos, videos, files; scales on its own",
    icon: "M4 7h16l-2 13H6zM4 7c0-1.7 3.6-3 8-3s8 1.3 8 3",
    capRead: INF,
    capWrite: INF,
    passRead: 1,
    passWrite: 1,
    store: true,
  },
  search: {
    label: "Search index",
    group: "Data",
    hint: "finds items by words; indexing writes are costly",
    icon: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4",
    capRead: 10_000,
    capWrite: 2_000,
    passRead: 1,
    passWrite: 1,
    store: true,
    shards: true,
  },
  queue: {
    label: "Queue",
    group: "Async",
    hint: "holds jobs so the caller does not wait",
    icon: "M4 6h16M4 12h16M4 18h10M17 15l3 3-3 3",
    capRead: 100_000,
    capWrite: 100_000,
    passRead: 1,
    passWrite: 1,
    async: true,
  },
  stream: {
    label: "Event stream",
    group: "Async",
    hint: "an ordered log many consumers read (Kafka-style)",
    icon: "M3 8c3-3 6 3 9 0s6-3 9 0M3 14c3-3 6 3 9 0s6-3 9 0",
    capRead: 1_000_000,
    capWrite: 1_000_000,
    passRead: 1,
    passWrite: 1,
    async: true,
  },
  notify: {
    label: "Notifications",
    group: "Async",
    hint: "push, email or SMS to users",
    icon: "M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
    capRead: 20_000,
    capWrite: 20_000,
    passRead: 1,
    passWrite: 1,
  },
  warehouse: {
    label: "Analytics",
    group: "Async",
    hint: "a warehouse for reports; off the request path",
    icon: "M4 20V10M10 20V4M16 20v-8M22 20H2",
    capRead: INF,
    capWrite: INF,
    passRead: 0,
    passWrite: 0,
  },
  external: {
    label: "External API",
    group: "Async",
    hint: "a service someone else runs",
    icon: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
    capRead: INF,
    capWrite: INF,
    passRead: 0,
    passWrite: 0,
  },
};

export const GROUPS: Group[] = ["Edge", "Compute", "Data", "Async"];
export const isKind = (k: unknown): k is KindId =>
  typeof k === "string" && Object.hasOwn(KINDS, k);

export type Carries = "read" | "write" | "both";

export type Comp = {
  id: string;
  kind: KindId;
  label: string;
  x: number;
  y: number;
  count: number; // instances, or replicas for a store
  shards: number; // stores only
  by: "you" | "claude";
  // clients only: the percent of the brief's reads and writes this client
  // makes (a viewer app all the plays, a creator app all the uploads); a
  // client without one splits what the others leave evenly
  readShare?: number;
  writeShare?: number;
};

// the four dots on a card a wire can run between
export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: Side[] = ["top", "right", "bottom", "left"];
export const isSide = (s: unknown): s is Side =>
  typeof s === "string" && (SIDES as string[]).includes(s);

export type Wire = {
  id: string;
  from: string;
  to: string;
  carries: Carries;
  times: number; // fan-out: each request becomes this many calls (e.g. one per follower)
  // the dots you dragged it between (Claude's wires have none: the canvas picks)
  fromSide?: Side;
  toSide?: Side;
};

export type Brief = {
  title: string;
  goals: string[];
  constraints: string[];
  scale: { label: string; value: string }[];
  reads: number; // requests/s at peak that read
  writes: number; // and that write
  // what one read and one write are for this system, e.g. "a message
  // delivered to one phone" (older maps have none)
  readIs?: string;
  writeIs?: string;
};

export type ReviewPoint = {
  level: "good" | "fix" | "think";
  text: string;
  on: string[]; // component ids it is about
};

export type Review = {
  at: number;
  summary: string;
  points: ReviewPoint[];
  // you changed the design while Claude was reviewing it: the review is of
  // the design before those changes
  edited?: boolean;
};

// the next thing to do, written when a deep dive is settled between checks,
// so the sidebar stops asking what you have just decided
export type NextStep = { at: number; text: string };

// how many times its capacity a part takes, as the cards and the review both
// say it: "1.3", "15", "533", "1.2k"
export const timesCap = (util: number): string =>
  util >= 1000
    ? `${+(util / 1000).toFixed(util >= 1e4 ? 0 : 1)}k`
    : util >= 100
      ? String(Math.round(util))
      : String(+util.toFixed(1));

export type Reference = {
  comps: { id: string; kind: KindId; label: string }[];
  wires: { from: string; to: string; carries: Carries; times: number }[];
  notes: string[];
};

export type Load = {
  reads: number;
  writes: number;
  capRead: number;
  capWrite: number;
  // reads and writes together, as a share of capacity (they share it)
  util: number;
  status: "idle" | "ok" | "busy" | "over" | "backlog";
  async: boolean;
};

// what the browser sees: everything but the reference, until you ask for it
export type DesignView = {
  brief: Brief | null;
  comps: Comp[];
  wires: Wire[];
  load: Record<string, Load>;
  review: Review | null;
  next: NextStep | null;
  reference: Reference | null;
};
