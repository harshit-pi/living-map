# Agent docs check

`check.py` checks this repo's agent docs (`AGENTS.md`, `CLAUDE.md`, `.claude/skills/`, `.mcp.json`) against the code, so they don't silently go stale.

## Run it

From the repo root (Python 3, nothing to install):

```bash
python3 .github/agent-docs/check.py
```

Run it:

- after editing any agent doc or skill (agents are told to do this themselves);
- after moving or renaming files, or changing `package.json` scripts;
- every few weeks, to catch drift.

Each problem is printed with the file, line and the fix. Exit code 1 means there are errors; warnings don't fail. You can also ask the agent: "run the agent docs check and fix what it reports".

## What it checks

- `CLAUDE.md` imports `AGENTS.md`; `AGENTS.md` is 200 lines or fewer
- every path in backticks exists (gitignored files are allowed)
- every `npm run <script>` exists in `package.json`
- each skill's `name` matches its folder and it has a `description`
- MCP config has no literal secrets

A line that deliberately names a missing path can end with `<!-- agent-docs: ignore -->`.
