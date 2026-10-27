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
npm install          # also installs the pre-commit hook
npm run dev          # server with reload on :4317, plus Vite on :5173 (?fixture=1 draws a fixture map, no server)
npm start            # build, then serve :4317 under the launcher, which restarts it after an update
```

`npm run skill` installs the `living-map` skill into `~/.claude/skills/` from your checkout, so `/living-map` in a Claude Code chat runs your copy.

## Before you open a pull request

```bash
npm run check        # ESLint, TypeScript, Prettier, tests
```

The same checks run in the pre-commit hook and in CI. Please don't bypass the hook with `--no-verify`.

- Add or update a test for any behaviour you change. The map's logic lives in `ledger/`; its tests run against a scripted model and transcripts written on the spot, so they need no network or API key.
- Changing what Claude is asked to do (the extractor's prompt in `ledger/extract.ts`, a side chat's in `ledger/sides.ts`)? Describe what you tried and what changed in the PR. `node eval/extract-run.ts` runs the extractor over your own chats offline and `node eval/extract-score.ts` scores it; they call the model and cost real money.
- Keep changes focused: one fix or feature per pull request.

## Updating dependencies

Dependabot opens a grouped pull request every week. To upgrade by hand instead:

```bash
npm run upgrade:check   # what can be upgraded, changes nothing
npm run upgrade         # minor and patch versions
npm run upgrade:latest  # major versions too
```

These use [npm-check-updates](https://github.com/raineorshine/npm-check-updates) with the settings in `.ncurc.cjs`:

- They skip any version less than 7 days old, since a bad release is usually caught and pulled within days.
- They hold back a version that another package's peer range doesn't accept yet, so `npm ci` keeps working.
- They skip any version that drops a Node release this project supports (`engines` in `package.json`).

`upgrade` and `upgrade:latest` first run `npm run upgrade:test` (the full checks, then the build) to make sure everything passes. Then they upgrade everything and run it again. If something fails, they retry one package at a time and revert only the ones that break. The packages that failed are listed with ✗ and their errors. Put the upgrade in its own pull request, with nothing else in it.

## Conventions

The full list is in [AGENTS.md](AGENTS.md). The main ones:

- Shared types live in `shared/`, used by both server and browser.
- Anything model-specific stays in `server/providers/`.
- Treat the model's output as untrusted: check it before it reaches the map.
- Colours come only from the roles in `web/brand.css`.
- Text people read says "you", in plain words.

## Issues

Use the bug report or feature request form when you open an issue. For a bug, include what you did, what you expected, what happened, and the map's outline if you can share it (ask your chat "what does my map say?"). Security problems go through the private route in [SECURITY.md](SECURITY.md), not an issue.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
