@AGENTS.md

## Keeping agent docs accurate

- If anything in `AGENTS.md` or `.claude/skills/` is wrong or missing, fix it in the same change.
- When you change code that one of them describes (commands, paths, patterns, behaviour), update it in the same change.
- Put each fact in the narrowest place: `AGENTS.md` only for what every task needs; detail for one area goes in a skill (`.claude/skills/<name>/SKILL.md`) that `AGENTS.md` lists.
- Before creating or editing any of them, follow the `maintaining-agent-docs` skill, then run `python3 .github/agent-docs/check.py`.

## Before you finish

- Run the verify command in `AGENTS.md` (its `## Verify` section) and fix what fails. Say what you ran.
- Comments explain why, in the present tense, in a few lines. No dates, names, ticket or PR numbers, or incident stories: those go in the commit message or PR. Refer to docs by skill name, not "see CLAUDE.md".

## `main` is PR-only

- Never commit on `main` or push to it; `.claude/hooks/protect-main.sh` blocks both. Branch first (`git switch -c <branch>`), push the branch, open a PR.
- Every merge to `main` publishes a release that running copies offer as an update, so `main` only moves through a reviewed PR.
- Other sessions may share this working tree. Check `git status` and the current branch before you start, and do not switch branches or reset under someone else's changes.

## Pull requests

- Before `gh pr create`, follow the `reviewing-before-a-pr` skill: a fresh subagent, given only the review checklist and your diff, reviews the change. Fix every Blocking and Should fix you confirm in the code (Nits are optional), and say in the PR's How tested that the review ran and what it found.
- Write the PR description in the sections of `.github/pull_request_template.md`; `gh pr create --body` does not apply the template for you.
- Link the GitHub issue (`Fixes #N`); if there is none, write `No issue`.
- Tick every Risk box that applies and say why under it; leave the rest unticked.
- Do not wait for reviews after opening the PR. As your last step, check once for comments from people: `python3 .github/agent-tools/pr_feedback.py list <pr>`. If it lists any, follow the `addressing-pr-reviews` skill.
