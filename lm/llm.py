"""Thin wrapper over headless `claude -p`, with an on-disk cache and token accounting.

Every call is cached by (prompt, system, model, schema), so re-running the
pipeline never re-spends tokens on work already done. Every real call is
appended to cache/usage.jsonl so the scorecard can report what the eval cost.
"""
import hashlib
import json
import pathlib
import subprocess
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
CACHE.mkdir(exist_ok=True)
_lock = threading.Lock()


def _key(*parts):
    return hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:24]


def call(prompt, system, model="haiku", schema=None, tag="", read_dir=None, retries=2):
    key = _key(prompt, system, model, schema, read_dir is not None)
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())

    # No MCP servers, settings or slash commands: cuts per-call overhead from
    # ~287k tokens (the user's MCP tool schemas) to under 1k.
    cmd = ["claude", "-p", "--model", model, "--output-format", "json",
           "--no-session-persistence", "--system-prompt", system,
           "--strict-mcp-config", "--mcp-config", str(ROOT / "empty-mcp.json"),
           "--setting-sources", "", "--disable-slash-commands"]
    if read_dir:
        cmd += ["--tools", "Read", "--allowedTools", "Read", "--add-dir", str(read_dir)]
    else:
        cmd += ["--tools", ""]
    if schema:
        cmd += ["--json-schema", json.dumps(schema)]

    last_err = None
    for _ in range(retries + 1):
        r = subprocess.run(cmd, input=prompt, capture_output=True, text=True,
                           cwd=str(CACHE), timeout=900)
        try:
            out = json.loads(r.stdout)
        except json.JSONDecodeError:
            last_err = (r.stdout[-500:] or r.stderr[-500:])
            continue
        if out.get("is_error"):
            last_err = out.get("result")
            continue
        if schema and out.get("structured_output") is None:
            last_err = "no structured_output"
            continue
        u = out.get("usage") or {}
        res = {
            "text": out.get("result", ""),
            "structured": out.get("structured_output"),
            "input_tokens": u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
            + u.get("cache_read_input_tokens", 0),
            "output_tokens": u.get("output_tokens", 0),
            "cost_usd": out.get("total_cost_usd") or 0.0,
            "num_turns": out.get("num_turns"),
            "model": model,
            "tag": tag,
        }
        path.write_text(json.dumps(res))
        with _lock, open(CACHE / "usage.jsonl", "a") as f:
            f.write(json.dumps({k: res[k] for k in ("tag", "model", "input_tokens", "output_tokens", "cost_usd", "num_turns")}) + "\n")
        return res
    raise RuntimeError(f"claude -p failed for {tag}: {last_err}")


def approx_tokens(text):
    """Rough token count (chars / 4); good enough to compare context sizes."""
    return max(1, len(text) // 4)
