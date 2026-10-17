# Contributing to Living Map

Thanks for helping. Issues, ideas and pull requests are all welcome.

## How changes get in

`main` only changes through a pull request with passing CI, and every merge to `main` is published as a release that everyone running Living Map installs with one click. So keep `main` working, and keep each pull request to one fix or feature.

**Anyone (the usual open-source way):**

1. Fork this repository on GitHub, then clone your fork and add this one as `upstream`:
   ```bash
   git clone https://github.com/<you>/living-map.git
   cd living-map
   git remote add upstream https://github.com/harshit-pi/living-map.git
   ```
2. Branch from the latest `main`: `git fetch upstream && git switch -c my-fix upstream/main`.
3. Commit (the pre-commit hook runs the checks), push to your fork, and open a pull request against `harshit-pi/living-map` `main`.
4. To pick up new changes while you work: `git fetch upstream && git rebase upstream/main`, then push again (`git push --force-with-lease` to your own branch is fine).

**Maintainers with write access** push branches to this repository directly instead of forking. Never push to `main`; it is protected.

On your first pull request a maintainer approves the CI run before it starts. Pull requests are squash-merged, so your branch's history does not need to be tidy.

The **Update** button always installs releases from this repository, even when you run Living Map from a fork.

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

## Issues

Use the bug report or feature request form when you open an issue. For a bug, include what you did, what you expected, what happened, and the map if you can share it (maps are JSON files in `~/.living-map/maps/`). Security problems go through the private route in [SECURITY.md](SECURITY.md), not an issue.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
