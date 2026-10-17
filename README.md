<p align="center"><img src="app/docs/logo.svg" alt="Living Map" width="260"></p>

<p align="center"><b>Understand anything by seeing it, and by doing it.</b><br>
A visual canvas that drives your own Claude Code: you steer and answer on the picture, not in a wall of text.</p>

https://github.com/user-attachments/assets/38625c2e-6cb5-4a5e-8310-b8fd85114ca8

---

Long AI answers are hard to hold in your head. Living Map turns the conversation into a picture you work on directly:

- **Explore** a question as a map of options and facts. Choose, challenge, go deeper, and reply on any node in its own side thread.
- **Learn** any subject (a protocol, a theory, a period of history, a coding problem). Claude draws it in the shape that fits: a sequence, a concept map, a timeline, a structure, or a grid. The key parts are left blank for you to fill, and Claude checks each one.
- **Play a step by hand** on a board, an array or a tree, move by move. Your clicks are checked instantly, with no model call. Coding problems end with **Write it**, where Claude traces your code on the example and tells you which line breaks.
- **Click any part** of a diagram to have it explained in plain words, broken down further, or discussed in a side thread.

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

- Each move sends the model the canvas and the one thread it belongs to, so the input stays flat as a conversation grows.
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
