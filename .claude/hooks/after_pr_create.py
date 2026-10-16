#!/usr/bin/env python3
"""After an agent opens a PR, tell it to check once for comments from people.

Claude Code runs this after every shell command (.claude/settings.json), with
the tool call as JSON on stdin. On `gh pr create` it adds that reminder to the
agent's context (JSON additionalContext; `--format kiro` prints plain text
instead). The review itself runs before the PR (the reviewing-before-a-pr
skill), so nothing here waits for one. Anything else, or any error, prints
nothing and exits 0. Standard library only.
"""

import json
import re
import sys

PR_CREATE = re.compile(r"(^|[;&|(]\s*|\s)gh\s+pr\s+create\b")
PR_URL = re.compile(r"https://github\.com/[\w.-]+/[\w.-]+/pull/(\d+)")


def message(event):
    tool_input = event.get("tool_input") or event.get("toolInput") or {}
    command = tool_input if isinstance(tool_input, str) else tool_input.get("command")
    if not command or not PR_CREATE.search(command):
        return None
    urls = PR_URL.findall(json.dumps(event.get("tool_response") or event))
    number = urls[-1] if urls else "<number>"
    return (
        f"You opened PR #{number}. Do not wait for reviews. As your last step, "
        "check once for comments from people: `python3 "
        f".github/agent-tools/pr_feedback.py list {number}`. If it lists any, "
        "follow the `addressing-pr-reviews` skill."
    )


def main():
    fmt = "claude" if "claude" in sys.argv[1:] else "kiro"  # --format claude|kiro
    try:
        text = message(json.load(sys.stdin))
    except ValueError:
        return 0
    if not text:
        return 0
    if fmt == "claude":
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": text,
            }
        }
        print(json.dumps(output))
    else:
        print(text)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # never get in the way because the hook broke
        sys.exit(0)
