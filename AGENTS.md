# Living Map

A local web app that keeps one live mind map of your Claude Code chat, beside it. Linked from a chat with `/living-map`, it follows the chat's transcript as it grows, files what is new (what waits on you, tasks, decisions, what changed in the code) with your own Claude Code, and draws it on a page you work by clicking: lenses for what is waiting, open, decided and changed; answers sent back to the chat; side chats on any box that know the whole chat.

## Stack

- Node 23.6+ runs the server's TypeScript directly (type stripping): no build step for the server.
- Server: Express 5, server-sent events, `node:sqlite`. Browser: React 19, Vite 8, Tailwind 4 (every colour and font in `web/brand.css`), React Flow 12.
- TypeScript 6, strict, one `tsconfig.json` for server, browser and shared code. Tests: Vitest. Lint: ESLint 10 flat config. Format: Prettier (defaults).

## Commands

```bash
npm install
npm start              # build, then serve http://localhost:4317 under server/launcher.ts
                       # (exit code 75 = restart after a one-click update)
npm run dev            # server with --watch, plus Vite on :5173 (?fixture=1 draws a fixture map, no server)
npm run check          # ESLint, tsc, Prettier, Vitest: the same as the pre-commit hook
npm test               # Vitest only
npm run upgrade:check  # list dependency upgrades .ncurc.cjs allows (week-old releases, peer- and engine-compatible)
npm run upgrade        # minor and patch upgrades; npm-check-updates doctor reverts any that fail upgrade:test (rewrites package.json and the lockfile; only when asked)
npm run upgrade:latest # the same, majors included (only when asked)
npm run skill          # install the living-map skill into ~/.claude/skills (writes outside the repo; only when asked)
npm run skill -- --hook  # also add its UserPromptSubmit hook to ~/.claude/settings.json (only when asked)
node eval/read-format.ts             # can models read mermaid+ as well as one line per item (calls the model, ~$0.50; only when asked)
node eval/transcripts.ts [N]         # the transcript reader over your N largest Claude Code chats (local, no model)
node eval/changes-retro.ts [N] [out] # what changed, rebuilt from your N latest sessions (local, no model)
node eval/extract-run.ts --pick 15 [--max-usd 40] [--fresh]  # the extractor over your own chats, offline, with 5 checkpoints each (calls the model; only when asked)
node eval/extract-label.ts [--fresh] <dir>...   # Opus labels each checkpoint (calls the model; only when asked)
node eval/extract-score.ts [<dir>...]           # recall and precision against the labels, and settle.md for your marks
```

The pre-commit hook (husky, `.husky/pre-commit`) runs lint-staged, then the full checks; each check's own exit code decides.

## Verify

```bash
npm run check && npm run build && python3 .github/agent-docs/check.py
```

For a UI change, also try it in the browser on a test server (below), on a linked chat.

## Layout

- `ledger/`: the map of a chat.
  - `transcript.ts` reads a Claude Code transcript incrementally (uuid dedupe, compactions through `logicalParentUuid`, queued prompts, sealing, edit patches, the question tool's questions and your picks as `turn.asked`, never other tool output).
  - `extract.ts` files new turns as ops: `extract()` on the provider, a fresh `claude -p` with its own system prompt, no tools, no cache and a JSON schema, on Claude Code's default model unless `{"ledgerModel": …}` in `~/.living-map/settings.json` names one; never Haiku for judgment. `apply.ts` checks every op (quotes, server-minted ids, who may write what) before it is stored. A state change lands even when its quote fails; a wait closed that way is marked `unconfirmed` (stored, migrated in `db.ts`) and listed under Waiting to check until you or a quoted change settles it.
  - `db.ts` is the store (`~/.living-map/ledger.db`, `node:sqlite`, migrated by `PRAGMA user_version` on open, after a copy to `ledger.db.before-v<N>`): a run's raw answer is saved first, then one transaction applies it and moves the read point.
  - `follow.ts` follows every linked chat (and measures how long after a turn seals it is filed: `health.filing` and `health.lag` in the view, one log line per run) — a notice (a background task finishing, the map's listener among them) is not a prompt, so what Claude adds to a filed turn after one is filed as more of that turn, from `Conv.readExtent`; `view.ts` builds `LedgerView` (`shared/ledger.ts`); `tasks.ts` replays Claude's own task list; `mermaid.ts` writes and parses mermaid+, the map's text form; `changes/` lifts file diffs into system-level change statements with no model.
  - `routes.ts` starts it all and serves `/api/ledger/view` and `/api/ledger/act`; `link.ts` answers `POST /api/link`; `outbox.ts` holds what the chat should hear (`~/.living-map/conversations/<first id>.json`).
  - `sides.ts` runs side chats: one long-lived `claude -p` per side chat with `sideArgs` (read-only `Read,Grep,Glob`, `--restricted`, no web, the chat's project as cwd plus `~/.living-map/sides/<chat>/` holding the rendered `items.md` and `turns.md`, never a transcript; `sides.test.ts` holds those args). Its fenced `proposal` block is checked by `checkProposal` and applied only on `apply-proposal`.
- `server/`: `index.ts` starts the provider, the ledger and the routes (`http.ts`). Every `/api` route but `GET /api/health` needs the local token (`auth.ts`): kept in `~/.living-map/token` (0600), sent as `X-LM-Token` by the skill, hook and scripts. The page signs in once by the link `/api/link` answers (`/auth?n=<code>&conv=<chat>`, one use, 5 min), which sets a year-long HttpOnly cookie and lands on `/?conv=<chat>`; the cookie alone allows only reads, and the page gets the token for writes from `/api/session` (`web/lib/session.ts`). `POST /api/open` (the map's ⋯ → Open in your browser) mints a fresh link and opens it with `browser.ts`; `POST /auth/here` (the signed-out page's Show my maps) sets the cookie for a page on this machine, by its Origin, with no token. A Host that is not localhost, or an Origin that is another page, is refused. New routes are listed in `auth.test.ts`, which fails until they are.
- The chat hears the map two ways: `POST /api/inbox` from `skill/hook.ts` with your next message, or at once through `GET /api/inbox/wait`, where `skill/wait.ts` (a listener the chat keeps running in the background) waits for anything marked `wake`. `GET /api/outline` is the map as text (`ledger/outline.ts`: what matters now first, settled topics folded; `?lens=waiting|open|decided` gives one section).
- `server/providers/`: the model. `types.ts` is the only seam; `claude-code.ts` implements it (`extract`, finding your chats with `claude-sessions.ts`, `childEnv` dropping the session variables of the chat that started the server). Pick another with `LIVING_MAP_PROVIDER`.
- `server/update.ts` and `server/launcher.ts`: the one-click update (compare with the latest GitHub release, pull, `npm ci`, build, restart).
- `web/`: `App.tsx` signs in; with `?conv=<chat>` it asks `GET /api/ledger/view` for that chat once (`map/probe.ts`) and lazy-loads `map/MapScreen.tsx`; with no chat it lists every mapped chat (`Chats.tsx`, `GET /api/ledger/chats`), each opening in a new tab. `map/layout.ts` places nodes from the items alone (column = depth, rows in tree order, newest first by `order` key), so a new item never moves a node above it, and `holdView` moves the camera by what moved below so the box you are looking at stays put; `layout.test.ts` holds that over a 300-step growth. Node size follows the pane's width class (`sizeFor`: narrower than 640 px gets `NARROW`), never its exact width.
- `skill/`: the `living-map` skill for users' own Claude Code. `SKILL.md` is a template (`{{APP_DIR}}`, `{{PORT}}`), `install.ts` writes it to `~/.claude/skills/living-map/` (the server rewrites an installed copy on start and after a one-click update, never a test server), `start.ts` starts the server detached so it outlives the chat that asked.
- A test server: `LIVING_MAP_HOME=<test home> PORT=<not 4317> node server/index.ts` keeps its own store and token and leaves the installed skill alone.

## Releases

Every push to `main` that passes CI publishes a GitHub release `v0.1.<run>` (the `release` job in `.github/workflows/ci.yml`). Running copies show **New version available** and install it with one click, so `main` is always shippable.

## Conventions

- Imports carry their extension (`./follow.ts`, `./App.tsx`); Node needs it for the server, and the browser follows the same rule. ESLint orders them: external, blank line, internal. <!-- agent-docs: ignore -->
- Anything model-specific lives in a provider.
- The model's output is untrusted: check every op before it reaches the store (`apply.ts`, `checkProposal`).
- Colours come only from the roles in `web/brand.css` (`bg-canvas`, `text-ink`, `bg-primary`, `border-success-line`, …): no Tailwind palette colours or hex codes in components. Every role has a light value and a dark one (under `prefers-color-scheme: dark`); set both, with text at 4.5:1 or more on the surfaces it sits on. The logo mark is `web/lib/mark.ts`; the favicon is drawn from it at startup.
- No `setState` inside effects: derive the value, or reset state when its key changes during render.
- One filled button per screen, marked `data-primary` (an open card or side chat owns it); everything else is outlined or behind a ⋯ (`web/components/More.tsx`). Subject matter Claude wrote (titles, quotes, answers) carries `data-content`, so interface words can be counted apart.
- Copy the user reads says "you", in plain words.

## Never

- Never use `--no-verify`, and never commit on or push to `main` (`.claude/hooks/protect-main.sh`).
- Never commit `out/`, `cache/`, `data/` or anything from `~/.living-map`: they can hold private transcripts and maps.
- Never break `npm ci`, `npm run build` or the launcher's restart: every running copy installs `main` with them.

## Skills

- `maintaining-agent-docs`: before creating or editing `AGENTS.md`, `CLAUDE.md` or a skill.
- `addressing-pr-reviews`: when a PR you opened has comments.
