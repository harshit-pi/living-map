# Living Map app

A local web app that drives your own Claude Code (`claude -p`) from a visual canvas.

- **Decide:** a question tree. Choose, go deeper, challenge, and reply on any node in a side thread.
- **Learn:** a path of steps plus a topic diagram in the shape that fits the subject (sequence, concept map, timeline, structure, grid). Key parts are left blank; you type on the diagram and Claude checks it.
- **Play a step:** do it by hand on a board, array or tree, move by move; clicks are checked instantly on the server. Coding problems end with **Write it**, where Claude traces your code.
- **Click any part** of a diagram to have it explained in plain words, go deeper, or ask about it in a side thread.

## Run

```bash
npm install
npm start          # builds, then serves http://localhost:4317
```

Maps are saved in `~/.living-map/maps/`; reopen any of them from **Maps ▾**.

## Files

| File | What it holds |
|---|---|
| `REQUIREMENTS.md` | what v1 must do, and the done-when tests |
| `server.mjs` | actions, Claude calls (stateless, streamed), live events |
| `lib.mjs` | prompts, op parsing, map and diagram logic (`node --test lib.test.mjs`) |
| `src/` | React frontend |
| `eval/forms.mjs` | does Learn pick a fitting, concrete diagram, and how fast |
| `research/visual-usefulness.md` | the evidence behind the canvas design |
