#!/usr/bin/env python3
"""Stop an agent from committing secrets.

Claude Code runs this before every shell command (.claude/settings.json), with
the tool call as JSON on stdin. On `git commit` it checks what would be
committed (the index, plus tracked changes for `-a`) for key and credential
files and for private keys or AWS key ids in the content, and exits 2 to block
the commit with the reasons. It does not depend on the repo's git hooks being
installed. Anything unexpected exits 0, so a broken hook never blocks work.
Standard library only.
"""

import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

COMMIT = re.compile(r"(^|[;&|(]\s*|\s)git(\s+-[Cc]\s+\S+)*\s+commit(?![\w-])")
ALL_FLAG = re.compile(r"\s(-[a-zA-Z]*a[a-zA-Z]*|--all)(\s|$)")
# File names that hold credentials. `.env.example` and `.env.production`
# (public build values) stay allowed; their content is still scanned.
BLOCKED_NAMES = [
    "*.p8",
    "*.p12",
    "*.pfx",
    "*.pem",
    "*.key",
    "*.keychain",
    "*.mobileprovision",
    "*.jks",
    "*.keystore",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    ".env",
    ".env.local",
    ".env.*.local",
    ".env.development",
]
BLOCKED_DIRS = {"secrets", ".secrets"}
CONTENT = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "a private key"),
    (re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"), "an AWS access key id"),
]
MAX_SCAN_BYTES = 2_000_000


def command_of(event):
    tool_input = event.get("tool_input") or event.get("toolInput") or {}
    if isinstance(tool_input, str):
        return tool_input
    return tool_input.get("command") or ""


def repo_dir(event, command):
    """The repo the commit runs in: `git -C dir`, a leading `cd dir &&`, or cwd."""
    base = Path(event.get("cwd") or ".").expanduser()
    match = re.search(r"git\s+-C\s+(\S+)", command) or re.match(
        r"\s*cd\s+(\S+)\s*&&", command
    )
    if match:
        base = base / Path(match.group(1).strip("'\"")).expanduser()
    result = subprocess.run(
        ["git", "-C", str(base), "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
    )
    return Path(result.stdout.strip()) if result.returncode == 0 else None


def git(root, *args):
    result = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True
    )
    return result.stdout.splitlines() if result.returncode == 0 else []


def name_problem(path):
    parts = PurePosixPath(path).parts
    if any(part in BLOCKED_DIRS for part in parts[:-1]):
        return "is inside a secrets/ folder"
    name = parts[-1] if parts else path
    for pattern in BLOCKED_NAMES:
        if fnmatch.fnmatch(name, pattern):
            return f"matches `{pattern}` (credentials file)"
    return None


def content_problem(root, path, staged):
    spec = f":{path}" if staged else None
    if spec:
        result = subprocess.run(
            ["git", "-C", str(root), "show", spec], capture_output=True
        )
        data = result.stdout if result.returncode == 0 else b""
    else:
        file = root / path
        data = file.read_bytes() if file.is_file() else b""
    if len(data) > MAX_SCAN_BYTES or b"\0" in data[:8000]:
        return None
    text = data.decode("utf-8", "replace")
    for regex, what in CONTENT:
        if regex.search(text):
            return f"contains {what}"
    return None


def problems(root, include_tracked_changes):
    files = {
        p: True
        for p in git(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR")
    }
    if include_tracked_changes:
        for path in git(root, "diff", "--name-only", "--diff-filter=ACMR"):
            files.setdefault(path, False)
    found = []
    for path, staged in sorted(files.items()):
        reason = name_problem(path) or content_problem(root, path, staged)
        if reason:
            found.append(f"  {path}: {reason}")
    return found


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return 0
    command = command_of(event)
    if not COMMIT.search(command):
        return 0
    root = repo_dir(event, command)
    if root is None:
        return 0
    found = problems(root, bool(ALL_FLAG.search(command)))
    if not found:
        return 0
    sys.stderr.write(
        "Commit blocked: it would add secrets.\n"
        + "\n".join(found)
        + "\nUnstage them (git restore --staged <file>), add them to .gitignore, and "
        "keep the values in the Keychain, a secret manager or the CI secret store. "
        "If a file is a false positive, ask the user to commit it themselves.\n"
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # never block work because the hook broke
        print(f"secret check skipped: {error}")
        sys.exit(0)
