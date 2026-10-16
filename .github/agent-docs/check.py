#!/usr/bin/env python3
"""Check agent docs (AGENTS.md, CLAUDE.md, .claude/skills, .mcp.json) against
the repo so they cannot silently go stale.

Usage: python3 .github/agent-docs/check.py [repo_root]
Exit code 1 when any error is found. Standard library only.
A line containing `agent-docs: ignore` (e.g. in an HTML comment) is skipped
by the path check, for sentences that deliberately name a missing path.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

AGENTS_WARN_LINES = 150
AGENTS_MAX_LINES = 200
SKILL_WARN_LINES = 250
SKILL_MAX_LINES = 500
# Paths every repo must ignore, checked without the user's global ignore file.
REQUIRED_IGNORES = {
    ".env": "env files",
    ".env.local": "env files",
    "x.p8": "private keys",
    "x.p12": "private keys",
    "x.pem": "private keys",
    "x.key": "private keys",
    "x.mobileprovision": "provisioning profiles",
    ".DS_Store": "macOS junk",
    "CLAUDE.local.md": "personal Claude notes",
    ".claude/settings.local.json": "personal Claude settings",
    ".claude/worktrees/x": "Claude worktrees",
}
# "see CLAUDE.md" and section pointers: CLAUDE.md only imports AGENTS.md and the
# shared rules, so repo detail it used to hold now lives elsewhere.
CLAUDE_REF_RE = re.compile(
    r"\bsee\s+(the\s+root\s+)?`?CLAUDE\.md`?|CLAUDE\.md`?\s*(§|'s\s+\"|section)", re.I
)
SKILL_NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SECRET_KEY_RE = re.compile(
    r"(key|token|secret|password|authorization|credential)", re.I
)
SECRET_VALUE_RE = re.compile(
    r"(ntn_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{10,}|rk_live_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}"
    r"|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abp]-[A-Za-z0-9-]{20,})"
)
CODE_EXTENSIONS = (
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".cjs",
    ".mjs",
    ".py",
    ".json",
    ".md",
    ".swift",
)
NPM_BUILTINS = {
    "install",
    "ci",
    "i",
    "exec",
    "init",
    "ls",
    "outdated",
    "update",
    "view",
    "audit",
}

MANAGED_MANIFEST = ".github/agent-docs/managed.json"
EDIT_UPSTREAM = (
    "It is managed upstream: change it there, not in this repo."
)


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, message, fix):
        self.errors.append(f"ERROR {where}: {message}\n      fix: {fix}")

    def warn(self, where, message, fix):
        self.warnings.append(f"warn  {where}: {message}\n      fix: {fix}")


def read_lines(path):
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def parse_front_matter(lines):
    """Return (dict, body_start_index) for a leading --- block, else (None, 0).
    Handles `key: value` and single-line or wrapped `[a, b]` lists."""
    if not lines or lines[0].strip() != "---":
        return None, 0
    data, key, buffer = {}, None, ""
    for i in range(1, len(lines)):
        line = lines[i]
        if line.strip() == "---":
            if key and buffer:
                data[key] = buffer.strip()
            return data, i + 1
        match = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if match and not buffer:
            key, value = match.group(1), match.group(2).split(" #")[0].strip()
            if value.startswith("[") and not value.endswith("]"):
                buffer = value
            else:
                data[key] = value
        elif buffer:
            buffer += " " + line.strip()
            if buffer.endswith("]"):
                data[key], buffer = buffer, ""
        elif key and line.startswith((" ", "\t")):
            data[key] = (data.get(key, "") + " " + line.strip()).strip()
    return None, 0


def unquote(value):
    return value.strip().strip("'\"")


def doc_files(root):
    files = []
    for name in ("AGENTS.md", "CLAUDE.md"):
        if (root / name).is_file():
            files.append(root / name)
    for folder in (".claude/skills",):
        base = root / folder
        if base.is_dir():
            files.extend(sorted(p for p in base.rglob("*.md") if p.is_file()))
    return files


def managed_paths(root):
    manifest = root / MANAGED_MANIFEST
    if not manifest.is_file():
        return {}
    try:
        return json.loads(manifest.read_text()).get("files", {})
    except (ValueError, AttributeError):
        return {}


# ---------------------------------------------------------------- checks


def check_entry_files(root, report):
    claude = root / "CLAUDE.md"
    if not claude.is_file():
        report.error(
            "CLAUDE.md", "missing", "add CLAUDE.md containing the line `@AGENTS.md`"
        )
    elif "@AGENTS.md" not in claude.read_text():
        report.error(
            "CLAUDE.md", "does not import AGENTS.md", "add the line `@AGENTS.md`"
        )

    agents = root / "AGENTS.md"
    if not agents.is_file():
        report.error(
            "AGENTS.md",
            "missing",
            "create AGENTS.md (see .claude/skills/maintaining-agent-docs)",
        )
        return
    count = len(read_lines(agents))
    if count > AGENTS_MAX_LINES:
        report.error(
            "AGENTS.md",
            f"{count} lines (limit {AGENTS_MAX_LINES})",
            "move detail for one area into a skill: .claude/skills/<name>/SKILL.md",
        )
    elif count > AGENTS_WARN_LINES:
        report.warn(
            "AGENTS.md",
            f"{count} lines (aim for {AGENTS_WARN_LINES} or fewer)",
            "trim, or move detail for one area into a skill",
        )


def check_skills(root, report):
    base = root / ".claude/skills"
    if base.is_dir():
        for folder in sorted(p for p in base.iterdir() if p.is_dir()):
            rel = f".claude/skills/{folder.name}/SKILL.md"
            skill = folder / "SKILL.md"
            if not skill.is_file():
                report.error(rel, "missing", "add SKILL.md or delete the folder")
                continue
            lines = read_lines(skill)
            meta, _ = parse_front_matter(lines)
            if meta is None:
                report.error(
                    rel,
                    "no front matter",
                    "start with `---`, `name: <folder>`, `description: ...`, `---`",
                )
                continue
            name, description = unquote(meta.get("name", "")), unquote(
                meta.get("description", "")
            )
            if name != folder.name:
                report.error(
                    rel,
                    f"name `{name}` does not match folder `{folder.name}`",
                    "make them identical",
                )
            if not SKILL_NAME_RE.match(folder.name) or len(folder.name) > 64:
                report.error(
                    rel,
                    "folder name must be lowercase letters, digits and hyphens (max 64)",
                    "rename the folder and `name`",
                )
            if not description:
                report.error(
                    rel,
                    "empty description",
                    "say what it does and when to use it, in third person",
                )
            elif len(description) > 1024:
                report.error(rel, "description over 1024 characters", "shorten it")
            if len(lines) > SKILL_MAX_LINES:
                report.error(
                    rel,
                    f"{len(lines)} lines (limit {SKILL_MAX_LINES})",
                    "move reference material into files next to SKILL.md",
                )
            elif len(lines) > SKILL_WARN_LINES:
                report.warn(
                    rel,
                    f"{len(lines)} lines (aim for {SKILL_WARN_LINES} or fewer)",
                    "move reference material into files next to SKILL.md",
                )


INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
NPM_RUN_RE = re.compile(r"\bnpm run ([A-Za-z0-9:_.-]+)")
NPM_SHORT_RE = re.compile(r"\bnpm (test|start)\b")


def path_candidate(token):
    token = token.strip().rstrip(".,;:)")
    token = re.sub(r":\d+(-\d+)?$", "", token)  # file.ts:42
    if token.startswith("@/"):
        token = token[2:]
    if not token or " " in token or any(c in token for c in "*?<>{}$|()[]=\"'"):
        return None
    if (
        token.startswith(("http", "~", "/", "-", "#", "@", "../"))
        or "://" in token
        or "..." in token
    ):
        return None
    if "/" not in token and not re.search(r"\.[A-Za-z]{1,5}$", token):
        return None
    return token


def path_exists(root, doc_dir, token):
    for base in (root, doc_dir):
        target = base / token
        for ext in CODE_EXTENSIONS:
            candidate = Path(str(target) + ext)
            if candidate.exists() or candidate.is_symlink():
                return True
        if target.parent.is_dir() and target.name in ("index", ""):
            return True
    return False


def is_gitignored(root, token):
    """Generated or local-only files (e.g. amplifyconfiguration.json) may be named in docs."""
    if not (root / ".git").exists():
        return False
    result = subprocess.run(
        ["git", "-C", str(root), "check-ignore", "-q", "--no-index", token],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


IGNORE_MARKER = "agent-docs: ignore"


def check_references(root, report):
    top_level = {p.name for p in root.iterdir()}
    # scripts from the package.json at the root or one folder down (app/)
    scripts = None
    for package in [root / "package.json", *sorted(root.glob("*/package.json"))]:
        try:
            found = json.loads(package.read_text()).get("scripts", {})
        except (OSError, ValueError):
            continue
        scripts = (scripts or set()) | set(found)

    for path in doc_files(root):
        rel = path.relative_to(root).as_posix()
        in_fence = False
        for number, line in enumerate(read_lines(path), start=1):
            where = f"{rel}:{number}"
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
            if scripts is not None:
                names = NPM_RUN_RE.findall(line) + NPM_SHORT_RE.findall(line)
                for name in names:
                    if name not in scripts and name not in NPM_BUILTINS:
                        report.error(
                            where,
                            f"`npm run {name}`: no such script in package.json",
                            "fix the command, or remove it if the script is gone",
                        )
            if in_fence or IGNORE_MARKER in line:
                continue
            for raw in INLINE_CODE_RE.findall(line):
                token = path_candidate(raw)
                if not token:
                    continue
                first = token.lstrip("./").split("/")[0]
                is_local = (
                    token.startswith("./")
                    or first in top_level
                    or (path.parent / token.split("/")[0]).exists()
                )
                if not is_local:
                    continue  # branch names, URLs, package names, other repos
                if not path_exists(root, path.parent, token) and not is_gitignored(
                    root, token
                ):
                    report.error(
                        where,
                        f"`{raw}` does not exist",
                        "update the path to where it lives now, or remove the reference",
                    )


def walk_json(value, key=""):
    if isinstance(value, dict):
        for k, v in value.items():
            yield from walk_json(v, k)
    elif isinstance(value, list):
        for v in value:
            yield from walk_json(v, key)
    elif isinstance(value, str):
        yield key, value


def check_mcp(root, report):
    for rel in (".mcp.json",):
        path = root / rel
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text())
        except ValueError as exc:
            report.error(rel, f"invalid JSON ({exc})", "fix the syntax")
            continue
        for key, value in walk_json(data):
            literal = "${" not in value
            if SECRET_VALUE_RE.search(value) or (
                literal and SECRET_KEY_RE.search(key) and len(value) >= 12
            ):
                report.error(
                    rel,
                    f"`{key}` looks like a literal secret",
                    "use `${ENV_VAR}` and rotate the exposed value",
                )


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def managed_symlinks(root):
    manifest = root / MANAGED_MANIFEST
    try:
        return (
            json.loads(manifest.read_text()).get("symlinks", {})
            if manifest.is_file()
            else {}
        )
    except (ValueError, AttributeError):
        return {}


def check_managed(root, report, managed):
    for rel, target in managed_symlinks(root).items():
        path = root / rel
        if not path.is_symlink() or os.readlink(path) != target:
            report.error(
                rel,
                f"managed symlink must point to `{target}`",
                f"restore it. {EDIT_UPSTREAM}",
            )
    for rel, digest in managed.items():
        path = root / rel
        if not path.exists():
            report.error(rel, "managed file is missing", f"restore it. {EDIT_UPSTREAM}")
        elif path.is_file() and not path.is_symlink() and sha256(path) != digest:
            report.error(
                rel,
                "managed file was edited in this repo",
                f"revert the local edit. {EDIT_UPSTREAM}",
            )


def check_hygiene(root, report):
    agents = root / "AGENTS.md"
    if agents.is_file() and not re.search(
        r"^##+\s+Verify\b", agents.read_text(errors="replace"), re.M | re.I
    ):
        report.warn(
            "AGENTS.md",
            "no `## Verify` section",
            "add one naming the single command that checks a change end to end",
        )
    for path in doc_files(root):
        rel = path.relative_to(root).as_posix()
        if rel == "CLAUDE.md":
            continue
        for number, line in enumerate(read_lines(path), start=1):
            if CLAUDE_REF_RE.search(line) and IGNORE_MARKER not in line:
                report.warn(
                    f"{rel}:{number}",
                    "points to CLAUDE.md, which only imports AGENTS.md",
                    "point to AGENTS.md or the skill that now holds it",
                )
    if (root / ".git").exists():
        missing = sorted(
            {
                why
                for sample, why in REQUIRED_IGNORES.items()
                if not ignored(root, sample)
            }
        )
        if missing:
            report.warn(
                ".gitignore",
                "does not ignore " + ", ".join(missing),
                "add the standard block from the maintaining-agent-docs skill",
            )
        hooks = root / ".githooks"
        configured = subprocess.run(
            ["git", "-C", str(root), "config", "core.hooksPath"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        if hooks.is_dir() and not configured:
            report.warn(
                ".githooks",
                "the repo's git hooks are not enabled in this clone",
                "run `git config core.hooksPath .githooks`",
            )


def ignored(root, sample):
    result = subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "core.excludesFile=/dev/null",
            "check-ignore",
            "-q",
            "--no-index",
            sample,
        ],
        capture_output=True,
    )
    return result.returncode == 0


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    report = Report()
    managed = managed_paths(root)
    check_entry_files(root, report)
    check_skills(root, report)
    check_references(root, report)
    check_mcp(root, report)
    check_hygiene(root, report)
    check_managed(root, report, managed)

    for line in report.warnings + report.errors:
        print(line)
    if report.errors:
        print(
            f"\n{len(report.errors)} error(s). Fix them, then rerun: python3 .github/agent-docs/check.py"
        )
        return 1
    print(f"agent docs OK ({len(report.warnings)} warning(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
