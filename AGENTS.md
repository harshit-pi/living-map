# Living Map

A local web app that drives a model (your own Claude Code by default) from a visual canvas. **Explore**: a question as a decision board of options against what you want, with a tree view. **Learn**: any subject as a path of steps, a topic diagram with blanks you fill, and steps you play by hand.

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
npm run check          # ESLint, tsc, Prettier, Vitest: the same as the pre-commit hook
npm test               # Vitest only
npm run eval           # does Learn pick a fitting diagram, and how fast (calls the model, costs ~$1; only when asked)
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
- `app/server/providers/`: the model. `types.ts` is the only seam; `claude-code.ts` implements it with `claude -p`. To add a model, implement `ModelProvider` and register it in `index.ts`; pick it with `LIVING_MAP_PROVIDER`.
- `app/server/engine.ts`: one move at a time (queue, Stop), what the model is sent, streaming ops onto the canvas. `app/server/actions/`: one function per action. `app/server/store.ts`: maps on disk (`~/.living-map/maps/`). `app/server/http.ts`: routes.
- `app/server/update.ts` and `app/server/launcher.ts`: the one-click update (compare with the latest GitHub release, pull, `npm ci`, build, restart).
- `app/web/`: `App.tsx` is the shell; `screens/` (Start, Loading, Learn), `components/`, `hooks/`, `lib/` (live connection, API client, storage, step navigation).
- `app/eval/forms.ts`: the diagram-fit eval, through the same provider.
- Plugins add a mode of their own (Design is the first). The contract is `app/server/plugin.ts` and `app/web/plugin.ts`; the registries are `app/server/plugins.ts` and `app/web/plugins.ts`. Explore and Design are plugins; Learn is still built in. A plugin can name modes it switches with (`switchesWith`: Explore and Learn share one map) and add header controls (`Header`). A plugin lives in `app/plugins/<id>/`: `shared.ts` (types both sides use), `core.ts` (pure logic, tested), `server.ts` (prompt, ops, actions, browser view), `web/` (its screen). Its state is `map.data[<id>]`.

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
- Copy the user reads says "you", in plain words; the word for the left mode is **Explore** (older maps saved as "decide" are migrated on load).

## Never

- Never send an answer to the browser: scene moves, blank answers and accepted forms stay on the server.
- Never use `--no-verify`, and never commit on or push to `main` (`.claude/hooks/protect-main.sh`).
- Never commit `out/`, `cache/`, `data/` or anything from `~/.living-map`: they can hold private transcripts and maps.
- Never break `npm ci`, `npm run build` or the launcher's restart: every running copy installs `main` with them.

## Skills

- `maintaining-agent-docs`: before creating or editing `AGENTS.md`, `CLAUDE.md` or a skill.
- `addressing-pr-reviews`: when a PR you opened has comments.
