// The listener your main chat keeps running in the background (the
// living-map skill starts it): it waits on Living Map and ends the moment
// the map has something for the chat to hear now (a message you wrote to it
// from the map, a reply on a view, an option you picked), printing it. Its
// ending wakes the chat, which acts on it and starts it again.
//
//   node skill/wait.ts <port> <session id>

const port = Number(process.argv[2] ?? 4317);
const session = String(process.argv[3] ?? "");
// a chat left alone for this long stops listening; asked again, it resumes
const GIVE_UP_MS = 8 * 60 * 60_000;

async function main() {
  if (!/^[\w-]{1,80}$/.test(session)) {
    console.log("No conversation id: start it with the session id.");
    return;
  }
  const until = Date.now() + GIVE_UP_MS;
  while (Date.now() < until) {
    try {
      const r = await fetch(
        `http://127.0.0.1:${port}/api/inbox/wait?session=${session}&timeout=600`,
      );
      const { text } = (await r.json()) as { text?: string };
      if (text?.trim()) {
        console.log(`FROM YOUR LIVING MAP:\n${text}`);
        return;
      }
    } catch {
      // the server is restarting or stopped: try again shortly
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  console.log("Stopped listening to the map after 8 hours.");
}

void main();

// a module of its own, so its names stay its own
export {};
