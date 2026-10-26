# Living Map app

A local web app that keeps one live mind map of your Claude Code chat, beside it: it follows the chat's transcript as it grows, files what is new with your own Claude Code (`claude -p`), and draws it on a page.

## Run

Needs Node 23.6 or later and Claude Code (`claude`) on your PATH.

```bash
npm install
npm start          # builds, then serves http://localhost:4317 (restarts itself after an update)
```

`npm run server` serves without the launcher, so an update asks you to restart by hand. `npm run dev` runs the server with reload plus Vite on :5173 (`?fixture=1` draws a fixture map with no server behind it). `npm run check` runs lint, types, formatting and tests.

`npm run skill` installs the `living-map` skill into `~/.claude/skills/`: in any Claude Code chat, `/living-map` starts the server (`skill/start.ts`, detached, so it outlives the chat), links the chat over `POST /api/link` and opens its map. `GET /api/outline` gives the map as text, and the chat hears what you do on the map through `POST /api/inbox` (the hook) and `GET /api/inbox/wait` (the listener, `skill/wait.ts`). Every `/api` route but the health check needs the token the server keeps in `~/.living-map/token`; the page signs in through the one-time link `/api/link` answers.

## The model

The map talks to the model through one interface, `server/providers/types.ts`. Claude Code (`claude -p`) is the default; another model is one new file implementing `ModelProvider`, chosen with `LIVING_MAP_PROVIDER`.

## Layout

| Path       | What it holds                                                                 |
| ---------- | ----------------------------------------------------------------------------- |
| `ledger/`  | following a chat, filing its turns, the store, side chats, what changed       |
| `server/`  | routes, the token, the one-click update and its launcher, the model providers |
| `shared/`  | the shapes the server and the page exchange                                   |
| `web/map/` | the map's page                                                                |
| `skill/`   | the `living-map` skill, its installer, starter, hook and listener             |
| `eval/`    | the extractor's offline evals over your own chats                             |

Conventions for people and agents: [AGENTS.md](../AGENTS.md).
