---
name: maintaining-agent-docs
description: Rules for writing and updating AGENTS.md and the skills in .claude/skills. Use when creating or editing either, when one of them is wrong or out of date, or when a code change affects the commands, paths or patterns they describe.
---

# Maintaining agent docs

## Where things go

- **`AGENTS.md`**, loaded on every request: what the repo is, stack, commands, a `## Verify` section with the one command that checks a change end to end, layout, repo-wide conventions, never-rules, and a list of the repo's skills with when to use each. Aim for 150 lines; hard limit 200.
- **`.claude/skills/<name>/SKILL.md`**, loaded when relevant: detail for one area (a subsystem, a protocol, the release process) or a repeatable procedure with steps. Aim for 250 lines. List it in `AGENTS.md`.
- **`.mcp.json`**: MCP servers this repo needs. Secrets only as `${VAR}`.
- **A hook, test or CI check**: any rule that must never be broken. Prose is not enforcement.
- **Not in the repo**: personal preferences (`~/.claude/`), agent notes, task summaries.

To decide, ask: would every task in this repo need this? If not, it belongs in a skill.

## Writing rules

- Write only what an agent cannot learn from the code in a minute.
- Verify every path, command, version and name before writing it. If unsure, leave it out.
- One fact, one place. Point to the source file instead of copying types or config.
- Commands must be exact and runnable. Mark release, deploy and data-changing commands "only when asked".
- Rules must be concrete and checkable: "use `AlertPopUp`, not `Alert.alert`", not "handle errors well". Add a short reason only when the rule is not obvious.
- No dates, "new", "recently", history or changelogs. Delete what is no longer true instead of annotating it.

## Comments in code

- Say why, not what; present tense; a few lines. A longer explanation is a skill.
- No dates, names, ticket or PR numbers, "used to" or incident stories. They go in the commit message or PR.
- Point to a skill by name, never to a section of `CLAUDE.md` (it only imports `AGENTS.md`).

## Skills

- Folder name = `name`, lowercase with hyphens. Front matter:

  ```yaml
  ---
  name: adding-a-model-provider
  description: Adds a model behind the ModelProvider seam and registers it. Use when wiring a new model or API, or when a provider stops answering.
  ---
  ```

- The description is third person, says what the skill does and when to use it, and includes the words a request would use.
- Procedures: numbered steps with exact commands, a check that proves it worked, and the safety rules.
- Keep `SKILL.md` short. Put long reference material in a file next to it and link it from `SKILL.md` (one level deep).

## .gitignore baseline

Every repo's `.gitignore` includes this block (the doc check warns when one is missing):

```gitignore
# secrets and keys
.env
.env.local
.env.*.local
*.p8
*.p12
*.pem
*.key
*.mobileprovision
# personal and OS files
.DS_Store
CLAUDE.local.md
.claude/settings.local.json
.claude/worktrees/
```

## Before you finish

Run `python3 .github/agent-docs/check.py` and fix everything it reports.
