# Contributing to Living Map

Thanks for helping. Issues, ideas and pull requests are all welcome.

## Set up

You need Node.js 23.6 or later (the server's TypeScript runs directly, with no build step) and Claude Code signed in.

```bash
cd app
npm install          # also installs the pre-commit hook
npm run dev          # server with reload on :4317, plus Vite on :5173
```

## Before you open a pull request

```bash
npm run check        # ESLint, TypeScript, Prettier, tests
```

The same checks run in the pre-commit hook and in CI. Please don't bypass the hook with `--no-verify`.

- Add or update a test for any behaviour you change. Server logic lives in `app/server/core/` (pure functions) and `app/server/engine.ts`; the tests run the engine against a scripted model, so they need no network or API key.
- Changing what Claude is asked to do (the prompts in `app/server/core/prompts.ts`)? Describe what you tried and what changed in the PR. `npm run eval` measures diagram choice and speed on 12 questions; it calls the model and costs about $1.
- Keep changes focused: one fix or feature per pull request.

## Conventions

The full list is in [AGENTS.md](AGENTS.md). The main ones:

- Shared types live in `app/shared/model.ts`, used by both server and browser.
- Anything model-specific stays in `app/server/providers/`; the engine never names Claude.
- Treat the model's output as untrusted: clean it before it reaches the map, and never send an answer to the browser.
- Colours come only from the roles in `app/web/brand.css`.
- Text people read says "you", in plain words.

## Reporting a bug

Please include what you did, what you expected, what happened, and the map if you can share it. Maps live in `~/.living-map/maps/` as JSON files.
