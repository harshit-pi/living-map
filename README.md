<p align="center"><img src="app/docs/logo.svg" alt="Living Map" width="260"></p>

<p align="center"><b>Understand anything by seeing it, and by doing it.</b><br>
A visual canvas that drives your own Claude Code: you steer and answer on the picture, not in a wall of text.</p>

https://github.com/user-attachments/assets/5310e726-ee2f-4876-9324-3dee512b2bd5

---

Long AI answers are hard to hold in your head. Living Map turns the conversation into a picture you work on directly:

- **Explore** a question as a decision board: the options as columns, what you want as rows, and Claude's judgement in each cell, marked as a guess when no fact backs it. One filled **Next** button names the step (Fill the board, Case against the lead, Decide…); mark your musts, rate any cell yourself, then decide in one sheet with your reasons, and get a pre-mortem. Questions about causes open as a tree instead, and every node has its own side thread.
- **Learn** any subject (a protocol, a theory, a period of history, a coding problem) as a path of steps. Each step is a small model on one concrete case: you see it once, then build it back from memory, and the check, the hints and the misconceptions cost no model call. Days later it comes back for review with less help, in a mixed order. Older maps keep their diagram with blanks, and **Practise this as builds** turns one into steps.
- **Play a step by hand** on a board, an array or a tree, move by move. Your clicks are checked instantly, with no model call. Coding problems end with **Write it**, where Claude traces your code on the example and tells you which line breaks.
- **Click any part** of a diagram to have it explained in plain words, broken down further, or discussed in a side thread.
- **Design** a system the way a system-design book teaches it: Claude writes the brief (requirements and scale), you build the high-level design from typed components (load balancer, cache, queue, database, …), and a rough load check shows what falls over as you wire it. **Check my design** gets Claude's review against a reference it keeps hidden, then you work through the deep dives (fan-out, sharding, hot keys) in their own threads.

Everything runs on your machine. Living Map talks to the model through your own Claude Code (`claude -p`) and keeps your maps in `~/.living-map/`.

## Quick start

You need [Node.js](https://nodejs.org) 23.6 or later, and [Claude Code](https://claude.com/claude-code) installed and signed in (`claude` on your PATH).

```bash
git clone https://github.com/harshit-pi/living-map.git
cd living-map/app
npm install
npm start
```

Then open http://localhost:4317.

### Beside your Claude conversations

Install the `living-map` skill into your own Claude Code once:

```bash
cd living-map/app
npm run skill
```

Then, in any Claude Code conversation (the desktop app, the terminal, an IDE), say **/living-map** or "map this". Claude starts the server if it is not running, and opens a map of **that conversation**: the question you have been working on, what you want, and the options you named are already on the board. `/living-map learn <topic>` and `/living-map design <system>` open the other modes.

- Every move on the map resumes your conversation, forked and never saved, so the map knows everything said there and anything you say later. Your conversation itself is left exactly as it was.
- The map is one live page on http://localhost:4317: keep it in the desktop app's browser pane beside the chat, or in Chrome, and move between them freely.
- Ask the chat "what does my map say?" and it reads the map back; say "we picked B, update the map" and the map moves.
- Saying /living-map again in the same conversation reopens its map.

A move on a linked map costs what your next message in that conversation would: the conversation is read from the prompt cache your chat keeps warm, so a move is about $0.01–0.03. The first move after an hour away writes the cache again, as your chat would.

### Updates

Every push to `main` that passes CI publishes a release (`v0.1.<n>`).
When a newer release is out, the header shows **Update available**: one click pulls it (`git pull --rebase`), installs (`npm ci`), builds and restarts, and the page reloads into it.
It runs only on a clean checkout of `main`; otherwise the popover says what is in the way.

Model calls go through your Claude Code account and count toward its usage. Each move is one short, stateless call; Living Map defaults to low effort, which you can change from the model and effort pickers.

## How it works

```
browser ──actions──► server ──► engine (one move at a time) ──► model provider ──► claude -p
   ▲                                  │
   └──────── live events ◄────────────┘   the canvas updates as the reply streams in
```

- Each move sends the model the canvas and the one thread it belongs to, so the input stays flat as a conversation grows. A map opened from one of your conversations also resumes that conversation first (`claude -p --resume <id> --fork-session`).
- The model answers with a short caption plus a block of small JSON changes. The server cleans every change before it reaches the canvas, and never sends the browser an answer you have yet to work out.
- The model sits behind one interface (`app/server/providers/types.ts`). Claude Code is the default; another model is one new file.

## Project layout

| Path                | What it holds                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `app/`              | the Living Map app: server, browser, tests. Its [README](app/README.md) covers development; [AGENTS.md](AGENTS.md) the conventions. |
| `app/web/brand.css` | every colour and font, by role: restyle the app in one place                                                                        |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the checks every change must pass, and the code conventions.

## Security

The server listens on `127.0.0.1` only. See [SECURITY.md](SECURITY.md) to report a problem.

## License

[MIT](LICENSE)
