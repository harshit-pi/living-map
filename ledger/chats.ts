// The list the bare page shows (GET /api/ledger/chats): one line per mapped
// chat, the ones waiting on you first, so with several chats going you
// see which one needs you without opening each.

import type { Conv } from "./db.ts";
import type { ChatSummary, LedgerView } from "../shared/ledger.ts";

export function summarize(
  convs: Conv[],
  viewOf: (root: string) => LedgerView | null,
): ChatSummary[] {
  return convs
    .map((c): ChatSummary => {
      const v = viewOf(c.root);
      return {
        conv: c.root,
        title: c.title || v?.title || "",
        cwd: c.cwd,
        linkedAt: c.linkedAt,
        following: c.following,
        turns: v?.turns ?? 0,
        waiting: v?.strip.waiting.length ?? 0,
      };
    })
    .sort((a, b) => b.waiting - a.waiting || b.linkedAt - a.linkedAt);
}
