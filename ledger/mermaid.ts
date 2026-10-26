// mermaid+: the map's text form, written from the items and read back by our
// own parser. It is plain Mermaid `mindmap` syntax, so it renders as a mind
// map wherever Mermaid does, with a few conventions:
//
//   i10("How should clusters talk?")      indentation = parent and child
//   :::question answered                  type and state, right under its node
//   %% i10 owner=you src=t12              owners and source turns
//   %% i53 replaced-by i54                cross-links
//
// Labels are always quoted, and `"` `<` `>` encoded: Mermaid fails on bare
// brackets and strips anything that looks like HTML. A class line binds to
// whatever node comes just before it, so it is only ever written directly
// under its own node. Models read this; they never write it (a misplaced
// class line would silently re-type another item).

export const ITEM_TYPES = [
  "topic",
  "question",
  "option",
  "decision",
  "task",
  "ask",
  "assumption",
  "change",
  "finding",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type MapItem = {
  id: string; // minted by the server: i<n>
  type: ItemType;
  state: string;
  label: string;
  parent: string | null; // null: a child of the chat's root
  owner?: "you" | "claude";
  src?: string[]; // source turns, t<n>
  links?: { rel: string; to: string }[];
};

export type MapHeader = { title: string; conv: string; seq: number };

// the shape is a hint for a person reading the export; the class line carries
// the type for us
const SHAPES: Partial<Record<ItemType, [string, string]>> = {
  question: ["(", ")"],
  ask: ["{{", "}}"],
};
const shapeOf = (t: ItemType): [string, string] => SHAPES[t] ?? ["[", "]"];

// `#` first, so a label that already holds an entity comes back as written
const encode = (s: string) =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .trim() || "(untitled)";

const decode = (s: string) =>
  s
    .replace(/#quot;/g, '"')
    .replace(/#lt;/g, "<")
    .replace(/#gt;/g, ">")
    .replace(/#35;/g, "#");

// ids and states go into class and comment lines unquoted: keep them to
// letters, digits and dashes
const word = (s: string) => s.replace(/[^\w-]/g, "-") || "-";

export function toMermaid(items: MapItem[], header: MapHeader): string {
  const children = new Map<string | null, MapItem[]>();
  const known = new Set(items.map((i) => i.id));
  for (const i of items) {
    // an item whose parent is gone hangs from the root rather than vanishing
    const p = i.parent && known.has(i.parent) ? i.parent : null;
    children.set(p, [...(children.get(p) ?? []), i]);
  }
  const lines = ["mindmap", `  root(("${encode(header.title)}"))`];
  const notes: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const i of children.get(parent) ?? []) {
      const pad = "  ".repeat(depth);
      const [open, close] = shapeOf(i.type);
      lines.push(`${pad}${word(i.id)}${open}"${encode(i.label)}"${close}`);
      lines.push(`${pad}:::${i.type} ${word(i.state)}`);
      const extra = [
        i.owner ? `owner=${i.owner}` : "",
        i.src?.length ? `src=${i.src.map(word).join(",")}` : "",
      ].filter(Boolean);
      if (extra.length) notes.push(`%% ${word(i.id)} ${extra.join(" ")}`);
      for (const l of i.links ?? [])
        notes.push(`%% ${word(i.id)} ${word(l.rel)} ${word(l.to)}`);
      walk(i.id, depth + 1);
    }
  };
  walk(null, 2);
  return [
    ...lines,
    `%% lm v1 conv=${word(header.conv)} seq=${header.seq}`,
    ...notes,
  ].join("\n");
}

const NODE = /^( *)([\w-]+)(\(\(|\{\{|\(|\[)"(.*)"(\)\)|\}\}|\)|\])$/;
const CLASS = /^ *:::([\w-]+)(?: ([\w-]+))?$/;

// Our own reader of what toMermaid writes: the test oracle for the round
// trip, and how a map saved as text comes back. Lines it can't place are
// returned, never guessed at.
export function fromMermaid(text: string): {
  header: MapHeader;
  items: MapItem[];
  skipped: string[];
} {
  const header: MapHeader = { title: "", conv: "", seq: 0 };
  const items: MapItem[] = [];
  const byId = new Map<string, MapItem>();
  const skipped: string[] = [];
  // the open node at each depth, for parenting by indentation
  const stack: { depth: number; id: string | null }[] = [];
  let last: MapItem | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim() === "mindmap") continue;
    if (line.startsWith("%%")) {
      const parts = line.slice(2).trim().split(/\s+/);
      if (parts[0] === "lm") {
        for (const p of parts.slice(2)) {
          const [k, v] = p.split("=");
          if (k === "conv") header.conv = v ?? "";
          if (k === "seq") header.seq = Number(v) || 0;
        }
        continue;
      }
      const item = byId.get(parts[0] ?? "");
      if (!item) {
        skipped.push(line);
        continue;
      }
      if (parts.length === 3 && !parts[1]?.includes("=")) {
        item.links = [...(item.links ?? []), { rel: parts[1]!, to: parts[2]! }];
        continue;
      }
      for (const p of parts.slice(1)) {
        const [k, v = ""] = p.split("=");
        if (k === "owner" && (v === "you" || v === "claude")) item.owner = v;
        else if (k === "src") item.src = v.split(",").filter(Boolean);
        else skipped.push(line);
      }
      continue;
    }
    const cls = CLASS.exec(line);
    if (cls) {
      const type = cls[1] as ItemType;
      if (!last || !ITEM_TYPES.includes(type)) skipped.push(line);
      else {
        last.type = type;
        last.state = cls[2] ?? "";
      }
      continue;
    }
    const node = NODE.exec(line);
    if (!node) {
      skipped.push(line);
      continue;
    }
    const depth = node[1]!.length / 2;
    const [id, label] = [node[2]!, decode(node[4]!)];
    if (id === "root") {
      header.title = label;
      stack.length = 0;
      stack.push({ depth, id: null });
      last = null;
      continue;
    }
    while (stack.length && stack.at(-1)!.depth >= depth) stack.pop();
    const item: MapItem = {
      id,
      type: "topic",
      state: "",
      label,
      parent: stack.at(-1)?.id ?? null,
    };
    items.push(item);
    byId.set(id, item);
    stack.push({ depth, id });
    last = item;
  }
  return { header, items, skipped };
}

// The other form models could read: one line per item, its state inline and
// its parent named, with nothing bound by position. The reading eval
// (eval/read-format.ts) compares the two.
export function toLines(items: MapItem[], header: MapHeader): string {
  const q = (s: string) =>
    `"${s.replace(/[\r\n\t]+/g, " ").replace(/"/g, "'")}"`;
  return [
    `MAP ${q(header.title)} conv=${header.conv} seq=${header.seq}`,
    ...items.map((i) =>
      [
        i.id,
        i.type,
        i.state,
        q(i.label),
        `in=${i.parent ?? "root"}`,
        i.owner ? `owner=${i.owner}` : "",
        i.src?.length ? `src=${i.src.join(",")}` : "",
        ...(i.links ?? []).map((l) => `${l.rel}=${l.to}`),
      ]
        .filter(Boolean)
        .join(" "),
    ),
  ].join("\n");
}
