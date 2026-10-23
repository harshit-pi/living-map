// The living-map hook, run by your Claude Code each time you send a message
// (UserPromptSubmit): it asks Living Map what this conversation has not heard
// from its map (side chats answered, tasks you ticked) and hands that to
// Claude with your message. Quiet and quick when there is nothing, or when
// Living Map is not running. `npm run skill -- --hook` installs it.

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
      headers: { "content-type": "application/json" },
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
        additionalContext: `LIVING MAP: the user keeps a live map of this conversation at http://localhost:${port}/, with side chats that know everything said here. Since your last turn there:\n${text}\nTake this into account where it bears on the user's message; they may refer to it.`,
      },
    }),
  );
}

void main();
