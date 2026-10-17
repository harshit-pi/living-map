# Living Map app

A local web app that drives your own Claude Code (`claude -p`) from a visual canvas.

- **Explore:** a question as a decision board of options against what you want, with Claude's judgement in each cell; Choose records why and a pre-mortem. Questions about causes open as a tree. Reply on any node in a side thread.
- **Learn:** a path of steps; each is a small model on one concrete case that you see once, then build back from memory. The server checks the build against Claude's hidden model with no model call, and a step comes back days later with less help. Older maps keep the topic diagram with blanks.
- **Play a step:** do it by hand on a board, array or tree, move by move; clicks are checked instantly on the server. Coding problems end with **Write it**, where Claude traces your code.
- **Click any part** of a diagram to have it explained in plain words, go deeper, or ask about it in a side thread.

## Run

Needs Node 23.6 or later and Claude Code (`claude`) on your PATH.

```bash
npm install
npm start          # builds, then serves http://localhost:4317 (restarts itself after an update)
```

`npm run server` serves without the launcher, so an update asks you to restart by hand. `npm run dev` runs the server with reload plus Vite on :5173. `npm run check` runs lint, types, formatting and tests.

Maps are saved in `~/.living-map/maps/`; reopen any of them from **Maps ▾**.

## The model

The canvas talks to the model through one interface, `server/providers/types.ts`. Claude Code (`claude -p`) is the default; another model is one new file implementing `ModelProvider`, chosen with `LIVING_MAP_PROVIDER`.

## Layout

| Path                                  | What it holds                                             |
| ------------------------------------- | --------------------------------------------------------- |
| `shared/model.ts`                     | every shape the server and browser exchange               |
| `server/core/`                        | pure logic: prompts, reply parsing, map, diagram, scenes  |
| `server/providers/`                   | the model behind the canvas                               |
| `server/engine.ts`, `server/actions/` | the move queue, and one function per action               |
| `web/`                                | React app: `screens/`, `components/`, `hooks/`, `lib/`    |
| `eval/forms.ts`                       | does Learn pick a fitting, concrete diagram, and how fast |
| `REQUIREMENTS.md`, `research/`        | what v1 must do, and the evidence behind the design       |

Conventions for people and agents: [AGENTS.md](../AGENTS.md).
