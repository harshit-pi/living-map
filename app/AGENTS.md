# Living Map app

A local web app that drives a model (your own Claude Code by default) from a visual canvas. **Explore**: a question as a tree of options and facts. **Learn**: any subject as a path of steps, a topic diagram with blanks you fill, and steps you play by hand.

## Stack

- Node 23.6+ runs the server's TypeScript directly (type stripping): no build step for the server.
- Server: Express 5, server-sent events. Browser: React 19, Vite 8, Tailwind 4 (theme in `web/index.css`), React Flow 12, dagre 3.
- TypeScript 6, strict, one `tsconfig.json` for server, browser and shared code. Tests: Vitest. Lint: ESLint 10 flat config. Format: Prettier (defaults).

## Commands

```bash
npm install
npm start              # build the browser app, then serve http://localhost:4317
npm run dev            # server with --watch, plus Vite on :5173
npm run check          # ESLint, tsc, Prettier, Vitest: the same as the pre-commit hook
npm test               # Vitest only
npm run eval           # does Learn pick a fitting diagram, and how fast (calls the model, costs ~$1)
```

The pre-commit hook (husky, `app/.husky/pre-commit`) runs lint-staged, then the full checks. Never use `--no-verify`.

## Layout

- `shared/model.ts`: every shape the server and browser exchange (map, actions, events). Change it here, both sides follow.
- `server/core/`: pure logic, no I/O: prompts, reading the model's reply, the map, the topic diagram, scenes. Tested in `core.test.ts`.
- `server/providers/`: the model. `types.ts` is the only seam; `claude-code.ts` implements it with `claude -p`. To add a model, implement `ModelProvider` and register it in `index.ts`; pick it with `LIVING_MAP_PROVIDER`.
- `server/engine.ts`: one move at a time (queue, Stop), what the model is sent, streaming ops onto the canvas. `server/actions/`: one function per action. `server/store.ts`: maps on disk (`~/.living-map/maps/`). `server/http.ts`: routes.
- `web/`: `App.tsx` is the shell; `screens/` (Start, Loading, Explore, Learn), `components/`, `hooks/`, `lib/` (live connection, API client, storage, step navigation).
- `eval/forms.ts`: the diagram-fit eval, through the same provider.

## Conventions

- Imports carry their extension (`./engine.ts`, `./App.tsx`); Node needs it for the server, and the browser follows the same rule. ESLint orders them: external, blank line, internal.
- The engine never names Claude: anything model-specific lives in a provider.
- The model's output is untrusted (`Raw`): clean every field before it reaches the map (`cleanSpec`, `cleanScene`), and never send answers (scene moves, blank text) to the browser.
- Explanations are written only when a node is opened; a move asked while another runs waits in the queue, never refused.
- No `setState` inside effects: derive the value, or reset state when its key changes during render.
- Copy the user reads says "you", in plain words; the word for the left mode is **Explore** (older maps saved as "decide" are migrated on load).
