# Review checklist

The one checklist for reviewing a change in this repo. A fresh reviewer runs it on an agent's diff before the pull request opens (the `reviewing-before-a-pr` skill). You are the reviewer: report findings, and never edit files, commit or push.

## 1. Load the repo's rules

Before reading the diff, read the files below that exist. They are the source of truth for this repo's conventions and its "Never" rules.

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/skills/*/SKILL.md` files relevant to the changed paths (`AGENTS.md` lists which skill covers what).

Then read the whole diff, and read enough of the surrounding code to understand what the change does at runtime.

## 2. What to look for, in priority order

1. **Security and privacy:**
   - secrets, tokens or private keys reaching the repo, logs or responses
   - the model's output trusted without cleaning: every field of a reply passes through the cleaners in `app/server/core/` before it reaches the map, and ids go through `safeId`/`own`
   - answers reaching the browser: scene moves, blank answers (`map.answers`) and accepted forms stay on the server
   - a map, a note or a thread sent somewhere new (a new provider, a new network call, a log line)
   - the server listening beyond localhost, or a new route that runs commands or reads files from request input
2. **Correctness bugs:** wrong conditions, unhandled `undefined`, races between moves (one move at a time through the engine's queue; Stop must leave the map consistent), errors swallowed silently, React state set inside an effect.
3. **Release and update path:** every merge to `main` publishes a release that running copies install with one click (`app/server/update.ts`, `app/server/launcher.ts`, the `release` job in `.github/workflows/ci.yml`). A change that breaks `npm ci`, `npm run build` or the launcher's restart reaches every copy that clicks Update.
4. **Model calls:** a change to `app/server/core/prompts.ts` or what the engine sends changes cost and speed for every move. The PR should say what was measured.
5. **Tests:**
   - new branches with no test where the repo has tests for that area (Vitest: `app/server/core/core.test.ts`, the engine and updater tests)
   - a bug fix without a test that fails before the fix
   - tests that assert nothing meaningful
6. **PR description**, once the pull request exists: it should follow `.github/pull_request_template.md`:
   - What
   - Why, with the GitHub issue or `No issue`
   - How tested
   - Risk, with the applicable boxes ticked and explained

## 3. Rules for findings

- Report only issues you have verified by reading the code. For each one, give a concrete scenario: inputs or state, then the wrong outcome. When you can, prove it by running a focused test (`cd app && npx vitest run <file>`). A test you write goes outside the working tree, which other sessions may share, and is never committed.
- Do not report style or formatting (ESLint and Prettier cover it). Don't report speculative "consider" suggestions, or anything `AGENTS.md` says is acceptable.
- Report a pre-existing problem only if the change makes it worse, and label it "pre-existing".
- New or changed code comments that carry dates, names, ticket or PR numbers or incident history, or that run to several paragraphs, are a Nit: that belongs in the PR or a skill.

## 4. Severity

- **Blocking**: merging it as is breaks something or opens a hole. An answer sent to the browser, unclean model output reaching the map, a secret or build output committed, a user's maps lost or corrupted, a build or update that fails, a "Never" rule in `AGENTS.md` broken, or a fix undone together with its test.
- **Should fix**: a real defect, fixed in this change. A bug with a concrete failure scenario outside those cases, a doc rule from `AGENTS.md` skipped, a missing test the repo's rules call for, or a Risk box left unticked.
- **Nit**: correct as it is but could be clearer. Optional.

## 5. Report

1. A one-line verdict: "No blocking issues found", or "N issues to fix before merge" (Blocking and Should fix together).
2. One entry per finding, most severe first: severity, `file:line`, the defect, the failure scenario, the fix.
3. What you verified by running tests, if anything.

If you find nothing, still say what you checked.
