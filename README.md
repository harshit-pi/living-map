<p align="center"><img src="docs/logo.svg" alt="Living Map" width="260"></p>

<p align="center"><b>See where your Claude Code chat stands, at a glance.</b><br>
Living Map draws your chat as a mind map while you work: what waits on you, what is still open, what was decided. You answer Claude right on the map.</p>

https://github.com/user-attachments/assets/73b3762c-e3b1-4c2b-9492-965592b0af54

---

When a project gets too big for your head, you draw a mind map. When a Claude chat does, you scroll, and coming back to it means asking Claude "where were we?" and waiting while it digs through everything. Living Map is that answer, already sitting beside the chat. It is a view for you, not memory for Claude: it reads your chat as it grows and keeps it as one mind map in a page beside it:

- **It follows by itself.** Type `/living-map` once in a chat. A few seconds after each turn, the map files what was new: questions waiting on you, tasks Claude is on, decisions made, what changed in your code. You never tell it what happened.
- **What waits on you stays on top.** A question Claude asked stays in the strip at the top of the map until you deal with it, however far the chat has scrolled since. When work is waiting on your answer, the map draws what it holds up.
- **Lenses** show what matters now: **Waiting** (on you), **Open**, **Decided** and **Changed**. Settled topics fold away; each decision sits under the topic where it was made, and findings sit in the list.
- **Answer from the map.** Answer a question, pick an option or tick a task on the map, and it reaches your chat at once. Claude's reply opens with "From your map: you answered …" in your words, so the decision is in the chat's own transcript too.
- **A handover that is always written.** Each chat keeps one in `~/.living-map/handover/`, rewritten whenever its map changes: waiting on you, next steps, still open, and what was decided, with the date and the reason. A session that stops halfway still has one.
- **Side chats** on any item: a read-only Claude that has read the map and the chat, can read your project, and proposes changes to the map you apply with one click.
- An empty chat starts as an empty map that fills in as you talk. A chat you link partway through is read from its start, or from its newest 40 turns if it is longer.

### Isn't this just…?

- **Asking Claude "where were we?"** That works, but it costs a turn and answers in a wall of text. The map is already there when you come back, and you can click it.
- **A handover file, or ADRs?** Those work between sessions, and Living Map writes the handover for you. The map is for the moment you come back to a chat, or when Claude asks something and it scrolls away.
- **Shorter sessions?** Keep them short too. A two-hour session buries a question just as well, and with several sessions the question becomes which one is waiting on you.
- **A changelog?** A changelog says what changed. It doesn't say what Claude asked and is still waiting on, or what you decided and why.
- **A memory tool?** Memory tools help Claude remember. Living Map helps you see where the chat stands.

Everything runs on your machine. Living Map talks to the model through your own Claude Code (`claude -p`) and keeps its data in `~/.living-map/`.

## Install

You need [Node.js](https://nodejs.org) 23.6 or later, and [Claude Code](https://claude.com/claude-code) installed and signed in (`claude` on your PATH).

### Ask Claude Code to do it

Paste this into a Claude Code chat:

```text
Install Living Map for me from https://github.com/harshit-pi/living-map:
1. Check that `node -v` is 23.6 or newer and that `claude` is on my PATH. If not, stop and tell me what to install.
2. Clone it to ~/living-map (if that folder already exists, run `git pull` there instead), then run `npm install` in ~/living-map.
3. In ~/living-map, run `npm run skill -- --hook` to install the living-map skill and its hook.
4. Tell me it is done, and that I type /living-map in any Claude Code chat to open its map.
```

Then type **/living-map** in any chat: in the desktop app, the terminal or an IDE. If that chat does not list the skill yet, start a new one.

### Or by hand

```bash
git clone https://github.com/harshit-pi/living-map.git ~/living-map
cd ~/living-map
npm install
npm run skill -- --hook
```

- `npm run skill` installs the `living-map` skill into `~/.claude/skills/`. `--hook` also adds one `UserPromptSubmit` entry to `~/.claude/settings.json`, leaving the rest as it is: whatever you did on the map comes with your next message, if it has not reached the chat already.

## Using it

- `/living-map` starts the server if it is not running (in the background, so it outlives the chat), links the chat and opens the map: in the desktop app's browser pane beside the chat if there is one, or as a link to open. Nothing to choose, nothing to describe.
- Saying `/living-map` again in the same chat opens its map again. Another chat gets its own map.
- Ask the chat "what's pending?", "what's open?" or "what did we decide?" and it reads that one section of the map back: a few lines, not the chat again. "What does my map say?" or "where were we?" gets the whole outline: what waits on you, what is open, what was decided and what Claude is on, then the map with settled topics folded. For a new chat, point it at the handover instead: `~/.living-map/handover/projects/<folder>.md` (the project's path with every character but letters and digits turned into `-`, as Claude Code names its own folders: `/Users/me/work` → `-Users-me-work`) is the chat you changed last in that project, so one line in the project's `CLAUDE.md` can tell every new chat to read it first.
- A handover of each chat is kept on disk and rewritten whenever its map changes, so a session that stops halfway still leaves one: what waits on you, the next steps, what is still open, and what was decided, when and why. It's at `~/.living-map/handover/projects/<folder>.md` for the chat you were in most recently in a project folder (the folder's path with every character other than a letter or digit turned into `-`), and `~/.living-map/handover/<chat>.md` for each chat. One line in a project's CLAUDE.md, "Before anything else, read ~/.living-map/handover/projects/<folder>.md if it exists.", has every new chat start from it.
- The first time each kind of box is on screen, a tip explains it. Each tip shows once in that browser; **No more tips** turns them off and **Show tips again** (under ⋯) brings them back.
- The map is one page on http://localhost:4317. It stays signed in in the browser that opened it. To have it in your own browser too, open http://localhost:4317 there and click **Show my maps** (or choose **⋯ → Open in your browser** on the map); from then on that address lists every mapped chat, each opening in a new tab. Any browser on this machine can sign itself in that way, so on a computer you share, another account could see your maps.

**Cost.** Filing new turns is a quick call on Claude Code's default model that reads only those turns: about $1.70 per 100 turns on Opus at API prices, which on the author's own chats came to about 0.13% of the tokens the chat itself used. On a Claude subscription it counts toward your usage, and the page shows no prices. Side chats cost only when you open one.

## Updates

Every push to `main` that passes CI publishes a release (`v0.1.<n>`).
When a newer one is out, the map's top bar shows **New version available**. One click pulls it (`git pull --rebase`), installs (`npm ci`), builds and restarts, and the page reloads into it. The installed skill is rewritten from the new copy as the server starts.
It runs only on a clean checkout of `main`; otherwise the popover says what is in the way.

## How it works

```
your chat (transcript) ──new turns──► server ──► claude -p (files them as changes) ──► ~/.living-map/ledger.db
                                         │                                                  │
your chat ◄──answers, picks, ticks───────┤◄──────────────── the map page ◄──live view───────┘
```

- The server reads your chat's transcript as it grows, and never tool output. A fresh `claude -p` call with no tools turns the new turns into typed changes, and code checks each one before it is stored.
- The map never re-reads the whole chat: each call is sent the map so far and only the turns since the last call.
- Side chats run as their own `claude -p`, read-only and kept to your project folder, with no web.
- The model sits behind one interface (`server/providers/types.ts`). Claude Code is the default; another model is one new file.

## Project layout

| Path            | What it holds                                                         |
| --------------- | --------------------------------------------------------------------- |
| `ledger/`       | the map of your chat: following the transcript, the store, side chats |
| `server/`       | routes, the token, the one-click update, the model providers          |
| `web/map/`      | the map's page                                                        |
| `web/brand.css` | every colour and font, by role: restyle the app in one place          |
| `skill/`        | the `living-map` skill, its installer, starter, hook and listener     |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the checks every change must pass, and the code conventions, and [AGENTS.md](AGENTS.md) for how the code fits together.

## Security

The server listens on `127.0.0.1` only, and every API call needs a local token kept in `~/.living-map/token`, readable only by you. See [SECURITY.md](SECURITY.md) to report a problem.

## License

[MIT](LICENSE)
