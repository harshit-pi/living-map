# Living Map

A local web app that drives a model (your own Claude Code by default) from a visual canvas. **Explore**: a question as a decision board of options against what you want, with a tree view. **Learn**: any subject as a path of steps; each step is a small model you see once and build back from memory, checked by the server, then rebuilt days later with less help (older maps keep the topic diagram with blanks).

The app lives in `app/`; run every npm command there.

## Stack

- Node 23.6+ runs the server's TypeScript directly (type stripping): no build step for the server.
- Server: Express 5, server-sent events. Browser: React 19, Vite 8, Tailwind 4 (every colour and font in `app/web/brand.css`), React Flow 12, dagre 3.
- TypeScript 6, strict, one `app/tsconfig.json` for server, browser and shared code. Tests: Vitest. Lint: ESLint 10 flat config. Format: Prettier (defaults).

## Commands

```bash
cd app
npm install
npm start              # build, then serve http://localhost:4317 under server/launcher.ts
                       # (exit code 75 = restart after a one-click update)
npm run dev            # server with --watch, plus Vite on :5173
LIVING_MAP_CLOCK_SKEW_DAYS=8 npm start   # testing only: Learn's review clock runs 8 days ahead (server/clock.ts)
npm run check          # ESLint, tsc, Prettier, Vitest: the same as the pre-commit hook
npm test               # Vitest only
npm run skill          # install the living-map skill into ~/.claude/skills (writes outside the repo; only when asked)
npm run eval           # does Learn pick a fitting diagram, and how fast (calls the model, costs ~$1; only when asked)
LIVING_MAP_HOME=<test home> npm run eval:moves -- <label>   # tokens, time and quality per move on fixed topics (~$0.75; only when asked)
node eval/moves-compare.ts <label> <label>                  # those runs side by side → eval/moves-results.md
```

The pre-commit hook (husky, `app/.husky/pre-commit`) runs lint-staged, then the full checks.

## Verify

```bash
cd app && npm run check && npm run build && cd .. && python3 .github/agent-docs/check.py
```

For a UI change, also run `npm start` and try it in the browser: Explore and Learn.

## Layout

- `app/shared/model.ts`: every shape the server and browser exchange (map, actions, events, updates). Change it here, both sides follow.
- `app/server/core/`: pure logic, no I/O: prompts, reading the model's reply, the map, the topic diagram, scenes. Tested in `app/server/core/core.test.ts`.
- `app/server/providers/`: the model. `types.ts` is the only seam; `claude-code.ts` implements it with `claude -p`, keeping one spare process started for the next move (`warm`): a mode's system prompt is the same on every move, and a move's own sections go in its message (`promptParts` in `app/server/core/prompts.ts`). To add a model, implement `ModelProvider` and register it in `index.ts`; pick it with `LIVING_MAP_PROVIDER`.
- `app/server/engine.ts`: one move at a time (queue, Stop), what the model is sent, streaming ops onto the canvas. `app/server/actions/`: one function per action. `app/server/store.ts`: maps on disk (`~/.living-map/maps/`). `app/server/http.ts`: routes.
- Linked maps: `map.conversation` names one of your Claude Code conversations; every move resumes it, forked and unsaved (`--resume <id> --fork-session`), with `LINKED` (`app/server/core/prompts.ts`) added to the system prompt. `claude` runs without the session variables of the chat that started the server (`childEnv`), and a linked move is priced from its own tokens (`priceOf`): a resumed conversation's CLI total includes everything it cost before. Conversations are found on disk by `app/server/providers/claude-sessions.ts`; `app/server/actions/link.ts` answers `POST /api/link` (open or start a conversation's map, or run a message on it) and `GET /api/outline` (the map as text, only what the browser sees; a plugin adds its part with `readout`).
- `app/skill/`: the `living-map` skill for users' own Claude Code. `SKILL.md` is a template (`{{APP_DIR}}`, `{{PORT}}`), `install.ts` writes it to `~/.claude/skills/living-map/` (the server rewrites an installed copy on start), `start.ts` starts the server detached so it outlives the conversation that asked.
- `app/server/update.ts` and `app/server/launcher.ts`: the one-click update (compare with the latest GitHub release, pull, `npm ci`, build, restart).
- `app/web/`: `App.tsx` is the shell; `screens/` (Start, Loading), `components/`, `hooks/`, `lib/` (live connection, API client, storage).
- `app/eval/forms.ts`: the diagram-fit eval, through the same provider. `app/eval/moves.ts`: real moves through the engine (Learn, Explore), with output tokens, first word, total time and the quality signals the code has.
- Every mode is a plugin: Explore, Learn and Design. The contract is `app/server/plugin.ts` and `app/web/plugin.ts`; the registries are `app/server/plugins.ts` and `app/web/plugins.ts` (a map whose mode is not installed is served as Learn; a new one starts as Explore). A plugin can name modes it switches with (`switchesWith`: Explore and Learn share one map), act when a map is switched into it (`enter`: Learn lays out a path), and add header controls (`Header`). A plugin lives in `app/plugins/<id>/`: `shared.ts` (types both sides use), `core.ts` (pure logic, tested), `server.ts` (prompt, ops, actions, browser view), `web/` (its screen). Its state is `map.data[<id>]`.
- A Learn map is `build` or `classic` (`map.data.learn.mode`). Build (every new map): `app/plugins/learn/core.ts` grades your build against Claude's hidden model with no model call; `build.ts` holds its prompt, ops and actions; its screen is `web/BuildScreen.tsx` (`web/view.ts` holds the one busy guard: a button that starts a paid move is off while a move runs or waits). Classic (a map with no `data.learn`) is served exactly as before: its state is the map's top-level fields (`diagram`, `fills`, `answers`, `scenes`, `play`), applied by core (`app/server/core/diagram.ts`, `scene.ts`, `canvas.ts`); Practise this as builds turns it into a build map and keeps them. Hints and shown answers on classic maps are core (`app/server/actions/steps.ts`): Design uses them too.
- Learn's review schedule reads the time only through `app/server/clock.ts`; `LIVING_MAP_CLOCK_SKEW_DAYS` moves it forward by whole days, for trying a return visit (testing only).
- Explore's board keeps its options, questions and wants as ordinary nodes (a want is a fact), so Learn and the Tree still read them; everything else (rows, cells, the stand, commits) is `map.data.explore`. `reconcile` in `app/plugins/explore/core.ts` prunes it against the nodes; `view` and `outline` run it on a copy, so opening a map writes nothing. Next's step is `nextGap` there: `label` is what the server knows a move by ("Next: <label>"), `short` is the button's few words, and it never names the option Claude leads; deciding is the free `choose` gap, which opens the Decide sheet.

## Releases

Every push to `main` that passes CI publishes a GitHub release `v0.1.<run>` (the `release` job in `.github/workflows/ci.yml`). Running copies show **Update available** and install it with one click, so `main` is always shippable.

## Conventions

- Imports carry their extension (`./engine.ts`, `./App.tsx`); Node needs it for the server, and the browser follows the same rule. ESLint orders them: external, blank line, internal. <!-- agent-docs: ignore -->
- The engine never names Claude: anything model-specific lives in a provider.
- The model's output is untrusted (`Raw`): clean every field before it reaches the map (`cleanSpec`, `cleanScene`, and a plugin's own cleaners).
- A plugin's `view` is all the browser sees of its state: anything the user should work out (Design's reference design) stays out until they ask for it.
- Explanations are written only when a node is opened; a move asked while another runs waits in the queue, never refused.
- Colours come only from the roles in `app/web/brand.css` (`bg-canvas`, `text-ink`, `bg-primary`, `border-success-line`, …): no Tailwind palette colours or hex codes in components. The logo mark is `app/web/lib/mark.ts`; the favicon is drawn from it at startup.
- No `setState` inside effects: derive the value, or reset state when its key changes during render.
- One filled button per screen in Explore and Learn, marked `data-primary` (an open sheet or panel owns it); everything else is outlined or behind a ⋯ (`app/web/components/More.tsx`). Subject matter Claude wrote (titles, notes, its lines) carries `data-content`, so interface words can be counted apart.
- Copy the user reads says "you", in plain words; the word for the left mode is **Explore** (older maps saved as "decide" are migrated on load).

## Never

- Never send an answer to the browser: scene moves, blank answers, accepted forms and Learn's step models stay on the server.
- Never use `--no-verify`, and never commit on or push to `main` (`.claude/hooks/protect-main.sh`).
- Never commit `out/`, `cache/`, `data/` or anything from `~/.living-map`: they can hold private transcripts and maps.
- Never break `npm ci`, `npm run build` or the launcher's restart: every running copy installs `main` with them.

## Skills

- `maintaining-agent-docs`: before creating or editing `AGENTS.md`, `CLAUDE.md` or a skill.
- `addressing-pr-reviews`: when a PR you opened has comments.
