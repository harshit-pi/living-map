// A synthetic map of one long chat, in the shapes the extractor files: used
// by the mermaid+ tests and the reading eval. Written by hand; no real
// transcript content.

import type { MapHeader, MapItem } from "../mermaid.ts";

export const HEADER: MapHeader = {
  title: "Living Map: auth, header and v3 design",
  conv: "8110f9da",
  seq: 430,
};

const it = (
  id: string,
  type: MapItem["type"],
  state: string,
  label: string,
  parent: string | null,
  extra: Partial<MapItem> = {},
): MapItem => ({ id, type, state, label, parent, ...extra });

export const ITEMS: MapItem[] = [
  it("i1", "topic", "done", "Teleport the cloud session", null, {
    src: ["t1"],
  }),
  it("i2", "question", "answered", "Which checkout is teleport using?", "i1", {
    owner: "you",
    src: ["t2"],
  }),
  it("i3", "decision", "decided", "Use the main living-map checkout", "i2", {
    src: ["t4"],
  }),
  it("i4", "task", "done", "Install the living-map skill", "i1", {
    owner: "claude",
    src: ["t5"],
  }),

  it("i5", "topic", "done", "Secure the local API", null, { src: ["t40"] }),
  it("i6", "finding", "said", "Any website can POST /api/update", "i5", {
    src: ["t41"],
  }),
  it(
    "i7",
    "decision",
    "decided",
    "Token on every route but /api/health",
    "i5",
    {
      src: ["t42"],
    },
  ),
  it("i8", "question", "answered", "Rotate the token on every start?", "i5", {
    owner: "you",
    src: ["t43"],
  }),
  it("i9", "option", "dropped", "Rotate on every start", "i8", {
    src: ["t43"],
  }),
  it("i10", "option", "taken", "Keep the token across restarts", "i8", {
    src: ["t44"],
  }),
  it("i11", "task", "done", "Write auth tests for Host and Origin", "i5", {
    owner: "claude",
    src: ["t45"],
  }),
  it("i12", "ask", "done", "Open PR #21?", "i5", {
    owner: "you",
    src: ["t46"],
  }),
  it(
    "i13",
    "assumption",
    "confirmed",
    "Pages use the cookie only for reads",
    "i5",
    {
      src: ["t42"],
    },
  ),

  it("i14", "topic", "done", "Simplify the map's header", null, {
    src: ["t60"],
  }),
  it(
    "i15",
    "decision",
    "decided",
    "No view switcher, New or Maps on a chat map",
    "i14",
    {
      src: ["t60"],
    },
  ),
  it("i16", "change", "removed", "Segmented view switcher <Segmented>", "i14", {
    src: ["t61"],
  }),
  it("i17", "change", "removed", "MapsMenu in the header", "i14", {
    src: ["t61"],
  }),
  it("i18", "ask", "waiting", "Push ui/chat-map-header?", "i14", {
    owner: "you",
    src: ["t62"],
  }),

  it("i19", "topic", "active", "Design v3: one map in mermaid+", null, {
    src: ["t80"],
  }),
  it(
    "i20",
    "question",
    "answered",
    "What should the map's surface be?",
    "i19",
    {
      owner: "you",
      src: ["t85"],
    },
  ),
  it("i21", "option", "taken", "Mind map always on screen", "i20", {
    src: ["t86"],
  }),
  it("i22", "option", "dropped", "Inbox on top of a living doc", "i20", {
    src: ["t85"],
  }),
  it("i23", "option", "dropped", "Tabs: system and conversation", "i20", {
    src: ["t85"],
  }),
  it(
    "i24",
    "question",
    "answered",
    "Keep mermaid+ as a named language?",
    "i19",
    {
      owner: "you",
      src: ["t88"],
    },
  ),
  it("i25", "option", "taken", "Mermaid mindmap syntax", "i24", {
    src: ["t89"],
  }),
  it("i26", "option", "dropped", "Drop the name; outline + schema", "i24", {
    src: ["t88"],
  }),
  it("i27", "decision", "decided", "Side chats propose in JSON only", "i19", {
    src: ["t95"],
  }),
  it(
    "i28",
    "decision",
    "decided",
    "No Haiku for judgment; default model",
    "i19",
    {
      src: ["t93"],
    },
  ),
  it(
    "i29",
    "question",
    "open",
    "Does the strip answer 'what waits' as fast as a list?",
    "i19",
    {
      owner: "claude",
      src: ["t97"],
    },
  ),
  it(
    "i30",
    "assumption",
    "assumed",
    "Most sessions change nothing structural",
    "i19",
    {
      src: ["t83"],
    },
  ),
  it("i31", "task", "doing", "Phase 1: de-risk", "i19", {
    owner: "claude",
    src: ["t100"],
  }),
  it("i32", "task", "done", "extract() on the provider", "i31", {
    owner: "claude",
    src: ["t101"],
  }),
  it("i33", "task", "doing", "Transcript adapter tests", "i31", {
    owner: "claude",
    src: ["t101"],
  }),
  it("i34", "task", "to-do", "What changed from 20 past sessions", "i31", {
    owner: "claude",
    src: ["t101"],
  }),
  it(
    "i35",
    "ask",
    "waiting",
    "Delete the reviewer's shadow test repos?",
    "i19",
    {
      owner: "you",
      src: ["t98"],
    },
  ),

  it("i36", "topic", "open", "Networking for the clusters", null, {
    src: ["t120"],
  }),
  it("i37", "question", "open", "Keep Nebula or move to VPC peering?", "i36", {
    owner: "you",
    src: ["t121"],
    links: [{ rel: "blocks", to: "i46" }],
  }),
  it("i38", "option", "offered", "Keep the Nebula overlay", "i37", {
    src: ["t121"],
  }),
  it("i39", "option", "offered", "VPC peering between regions", "i37", {
    src: ["t121"],
  }),
  it("i40", "change", "removed", "Nebula overlay mesh", "i36", {
    src: ["t125"],
    links: [{ rel: "replaced-by", to: "i41" }],
  }),
  it("i41", "change", "added", "VPC peering (eu-west <-> us-east)", "i36", {
    src: ["t125"],
  }),
  it(
    "i42",
    "change",
    "changed",
    "Security group: Postgres open to 10.0.0.0/8",
    "i36",
    {
      src: ["t126"],
    },
  ),
  it("i43", "ask", "waiting", 'Confirm "Nebula removed" was intended', "i36", {
    owner: "you",
    src: ["t127"],
    links: [{ rel: "about", to: "i40" }],
  }),
  it(
    "i44",
    "finding",
    "concluded",
    "Cross-region traffic needs peering routes",
    "i39",
    {
      src: ["t130"],
    },
  ),
  it("i45", "assumption", "struck", "Nebula is only used by staging", "i36", {
    src: ["t122"],
  }),
  it("i46", "task", "to-do", "Add peering routes # both directions", "i36", {
    owner: "you",
    src: ["t131"],
  }),
];

// The questions of the reading eval: each answer is a set of item ids
// (empty when nothing matches), checked exactly.
export const QUESTIONS: { q: string; ids: string[] }[] = [
  {
    q: "Which items are waiting on the user right now?",
    ids: ["i18", "i35", "i37", "i43"],
  },
  {
    q: "Which option was taken for 'What should the map's surface be?'",
    ids: ["i21"],
  },
  {
    q: "Which options were dropped anywhere in the map?",
    ids: ["i9", "i22", "i23", "i26"],
  },
  { q: "What replaced the Nebula overlay mesh?", ids: ["i41"] },
  { q: "Which questions are still open?", ids: ["i29", "i37"] },
  { q: "Which open questions are the user's to answer?", ids: ["i37"] },
  { q: "Which tasks is Claude doing right now?", ids: ["i31", "i33"] },
  { q: "Which tasks are not started yet?", ids: ["i34", "i46"] },
  {
    q: "Which topic holds the ask about pushing ui/chat-map-header? Give the topic.",
    ids: ["i14"],
  },
  { q: "Which changes were removals?", ids: ["i16", "i17", "i40"] },
  { q: "Which items came from turn t125?", ids: ["i40", "i41"] },
  { q: "Which assumptions were struck?", ids: ["i45"] },
  {
    q: "Which items are direct children of the topic 'Secure the local API'?",
    ids: ["i6", "i7", "i8", "i11", "i12", "i13"],
  },
  {
    q: "What is the finding filed under the VPC peering option?",
    ids: ["i44"],
  },
  {
    q: "Which decisions were made in the v3 design topic?",
    ids: ["i27", "i28"],
  },
  {
    q: "Which item is the ask about, for the ask to confirm Nebula's removal?",
    ids: ["i40"],
  },
  { q: "Which topics are still open or active?", ids: ["i19", "i36"] },
  {
    q: "Which subtasks belong to 'Phase 1: de-risk'?",
    ids: ["i32", "i33", "i34"],
  },
  { q: "Which tasks does the user own?", ids: ["i46"] },
  { q: "Which items mention a security group?", ids: ["i42"] },
];
