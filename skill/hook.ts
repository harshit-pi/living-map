// The living-map hook, run by your Claude Code each time you send a message
// (UserPromptSubmit): it asks Living Map what this conversation has not heard
// from its map (side chats answered, tasks you ticked) and hands that to
// Claude with your message. Quiet and quick when there is nothing, or when
// Living Map is not running. `npm run skill -- --hook` installs it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { mapNote } from "./restate.ts";

// the local API's token (see server/auth.ts), written by the server on start
const token = (() => {
  try {
    return fs
      .readFileSync(
        path.join(
          process.env.LIVING_MAP_HOME ?? path.join(os.homedir(), ".living-map"),
          "token",
        ),
        "utf8",
      )
      .trim();
  } catch {
    return "";
  }
})();

const port = Number(process.argv[2] ?? process.env.PORT ?? 4317);

async function stdin(): Promise<string> {
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function main() {
  let session: string;
  try {
    session = String(JSON.parse(await stdin()).session_id ?? "");
  } catch {
    return;
  }
  if (!session) return;
  let text: string;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/inbox`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lm-token": token },
      body: JSON.stringify({ session }),
      // the server marks what it sends as heard: given up on too early, it
      // would be lost
      signal: AbortSignal.timeout(6000),
    });
    text = String(((await r.json()) as { text?: unknown }).text ?? "");
  } catch {
    return;
  }
  if (!text.trim()) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: mapNote(text, port),
      },
    }),
  );
}

void main();

// a module of its own, so its names stay its own
export {};
