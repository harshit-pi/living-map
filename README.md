<p align="center"><img src="app/docs/logo.svg" alt="Living Map" width="260"></p>

<p align="center"><b>A live map of your Claude Code chat, beside it.</b><br>
What waits on you, what is still open and what was decided, kept up to date as you talk, with nothing to ask for.</p>

https://github.com/user-attachments/assets/5310e726-ee2f-4876-9324-3dee512b2bd5

---

Long Claude Code sessions bury the things you need to act on. Living Map reads your chat as it grows and keeps it as one mind map in a page beside it:

- **It follows by itself.** Type `/living-map` once in a chat. A few seconds after each turn, the map files what was new: questions waiting on you, tasks Claude is on, decisions made, what changed in your code. You never tell it what happened.
- **Lenses** show what matters now: **Waiting** (on you), **Open**, **Decided** and **Changed**, with a strip that steps through them. Settled topics fold away; findings and settled decisions sit in the list.
- **Answer from the map.** Answer a question, pick an option or tick a task on the map, and it reaches your chat at once.
- **Side chats** on any item: a read-only Claude that has read the map and the chat, can read your project, and proposes changes to the map you apply with one click.
- An empty chat starts as an empty map that fills in as you talk. A chat you link partway through is read from its start, or from its newest 40 turns if it is longer.

The map of your chat (v3) is still being tried out, so it is behind a switch: the install below turns it on. With it off, Living Map opens the older views of a chat instead (Explore, Learn and Design, [below](#explore-learn-and-design)).

Everything runs on your machine. Living Map talks to the model through your own Claude Code (`claude -p`) and keeps its data in `~/.living-map/`.

## Install

You need [Node.js](https://nodejs.org) 23.6 or later, and [Claude Code](https://claude.com/claude-code) installed and signed in (`claude` on your PATH).

### Ask Claude Code to do it

Paste this into a Claude Code chat:

```text
Install Living Map for me from https://github.com/harshit-pi/living-map:
1. Check that `node -v` is 23.6 or newer and that `claude` is on my PATH. If not, stop and tell me what to install.
2. Clone it to ~/living-map (if that folder already exists, run `git pull` there instead), then run `npm install` in ~/living-map/app.
3. Turn on the live map of my chat: in ~/.living-map/settings.json set "ledger": true, keeping anything else already in that file (create the folder and file if they are missing).
4. In ~/living-map/app, run `npm run skill -- --hook` to install the living-map skill and its hook.
5. Tell me it is done, and that I type /living-map in any Claude Code chat to open its map.
```

Then type **/living-map** in any chat: in the desktop app, the terminal or an IDE. If that chat does not list the skill yet, start a new one.

### Or by hand

```bash
git clone https://github.com/harshit-pi/living-map.git ~/living-map
cd ~/living-map/app
npm install
npm run skill -- --hook
```

Then add `"ledger": true` to `~/.living-map/settings.json` (create it as `{"ledger": true}` if it is missing).

- `npm run skill` installs the `living-map` skill into `~/.claude/skills/`. `--hook` also adds one `UserPromptSubmit` entry to `~/.claude/settings.json`, leaving the rest as it is: whatever you did on the map comes with your next message, if it has not reached the chat already.
- Leave out `"ledger": true` to keep the older views.

## Using it

- `/living-map` starts the server if it is not running (in the background, so it outlives the chat), links the chat and opens the map: in the desktop app's browser pane beside the chat if there is one, or as a link to open. Nothing to choose, nothing to describe.
- Saying `/living-map` again in the same chat opens its map again. Another chat gets its own map.
- Ask the chat "what does my map say?" or "what's pending?" and it reads the map back.
- The first time each kind of box is on screen, a tip explains it. Each tip shows once in that browser; **No more tips** turns them off and **Show tips again** (under ⋯) brings them back.
- The map is one page on http://localhost:4317. It stays signed in in the browser that opened it; for another browser, say `/living-map` again for a fresh link.

**Cost.** Filing new turns is a quick call on Claude Code's default model that reads only those turns: about $1.70 per 100 turns on Opus at API prices. On a Claude subscription it counts toward your usage, and the page shows no prices. Side chats cost only when you open one.

## Explore, Learn and Design

With the switch off, the map of a chat is one of these views, picked from what the chat is doing (`/living-map explore <question>`, `/living-map learn <topic>` and `/living-map design <system>` pick one). You can also run them on their own: `npm start` in `app/`, then open http://localhost:4317.

- **Explore** a question as a decision board: the options as columns, what you want as rows, and Claude's judgement in each cell, marked as a guess when no fact backs it. One **Next** button names the step; mark your musts, rate any cell yourself, then decide in one sheet with your reasons and a pre-mortem. Questions about causes open as a tree.
- **Learn** any subject as a path of steps. Each step is a small model on one concrete case: you see it once, then build it back from memory, checked with no model call, and it comes back days later with less help. Play a step by hand on a board, an array or a tree; coding problems end with **Write it**, where Claude traces your code.
- **Design** a system the way a system-design book teaches it: Claude writes the brief, you build the design from typed components, a rough load check shows what falls over, and **Check my design** reviews it against a reference Claude keeps hidden.

## Updates

Every push to `main` that passes CI publishes a release (`v0.1.<n>`).
When a newer one is out, the page shows **Update available** (in the top bar of the map of your chat, in the header of the older views). One click pulls it (`git pull --rebase`), installs (`npm ci`), builds and restarts, and the page reloads into it. The installed skill is rewritten from the new copy as the server starts.
It runs only on a clean checkout of `main`; otherwise the popover says what is in the way.

## How it works

```
your chat (transcript) ──new turns──► server ──► claude -p (files them as changes) ──► ~/.living-map/ledger.db
                                         │                                                  │
your chat ◄──answers, picks, ticks───────┤◄──────────────── the map page ◄──live view───────┘
```

- The server reads your chat's transcript as it grows, and never tool output. A fresh `claude -p` call with no tools turns the new turns into typed changes, and code checks each one before it is stored.
- The map never re-reads the whole chat: each call is sent only the turns since the last one.
- Side chats run as their own `claude -p`, read-only and kept to your project folder, with no web.
- The model sits behind one interface (`app/server/providers/types.ts`). Claude Code is the default; another model is one new file.

## Project layout

| Path                | What it holds                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `app/`              | the Living Map app: server, browser, tests. Its [README](app/README.md) covers development; [AGENTS.md](AGENTS.md) the conventions. |
| `app/ledger/`       | the map of your chat: following the transcript, the store, side chats                                                               |
| `app/web/map/`      | the map's page                                                                                                                      |
| `app/web/brand.css` | every colour and font, by role: restyle the app in one place                                                                        |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the checks every change must pass, and the code conventions.

## Security

The server listens on `127.0.0.1` only, and every API call needs a local token kept in `~/.living-map/token`, readable only by you. See [SECURITY.md](SECURITY.md) to report a problem.

## License

[MIT](LICENSE)
