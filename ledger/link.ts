// A chat asks for its map (the living-map skill): the chat is found on disk
// and followed from now on; one already followed just opens again.

import type { Ledger } from "./follow.ts";
import type { ModelProvider } from "../server/providers/types.ts";

export type LinkResult = {
  error?: string;
  title?: string;
  created?: boolean; // followed for the first time just now
  conv?: string; // the chat's id on the map (its root id)
  conversation?: string; // the chat's title
  listen?: boolean; // the chat should start its listener
};

const str = (v: unknown, n: number) =>
  typeof v === "string" ? v.slice(0, n) : "";

export function linkChat(
  provider: ModelProvider,
  ledger: Ledger,
  body: Record<string, unknown>,
): LinkResult {
  if (!provider.findConversation)
    return { error: `${provider.name} cannot follow a chat.` };
  const c = provider.findConversation({
    id: str(body.session, 100) || undefined,
    cwd: str(body.cwd, 1000) || undefined,
  });
  if (!c)
    return {
      error:
        "Could not find that conversation. Pass its id as `session`, or the folder it runs in as `cwd`.",
    };
  const ids = [...(c.previous ?? []), c.id];
  const created = !ledger.rootOf(ids);
  ledger.follow(c);
  return {
    title: c.title,
    created,
    conversation: c.title,
    listen: true,
    conv: ledger.rootOf(ids) ?? c.id,
  };
}
