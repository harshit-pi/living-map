"""Load a Claude Code transcript (JSONL) into human turns.

A turn is one human message plus the assistant prose that follows it. Tool
calls and tool output are dropped: the ledger is built from what people and
the AI *said*, which is also what keeps extraction cheap.
"""
import json
from dataclasses import dataclass


@dataclass
class Turn:
    idx: int
    ts: str
    human: str
    assistant: str = ""


@dataclass
class Compaction:
    before_turn: int  # the summary replaced everything before this turn index
    summary: str


def _text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content
                         if isinstance(c, dict) and c.get("type") == "text")
    return ""


def load(path):
    seen, turns, compactions = set(), [], []
    with open(path, errors="ignore") as f:
        for line in f:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            uid = d.get("uuid")
            if uid in seen:
                continue  # resumed sessions duplicate earlier lines
            if uid:
                seen.add(uid)
            if d.get("isSidechain"):
                continue
            kind, msg = d.get("type"), d.get("message") or {}
            if kind == "user":
                text = _text(msg.get("content")).strip()
                if d.get("isCompactSummary"):
                    compactions.append(Compaction(len(turns), text))
                    continue
                if d.get("isMeta") or not text or text.startswith("<"):
                    continue
                turns.append(Turn(len(turns), d.get("timestamp", ""), text))
            elif kind == "assistant" and turns:
                text = _text(msg.get("content")).strip()
                if text:
                    t = turns[-1]
                    t.assistant = f"{t.assistant}\n\n{text}" if t.assistant else text
    return turns, compactions


def clip(text, head, tail):
    """Keep the start and the end: AI turns usually conclude at the bottom."""
    if len(text) <= head + tail:
        return text
    return f"{text[:head]}\n[…]" + (f"\n{text[-tail:]}" if tail else "")


def render_turns(turns, human_max=1800, ai_head=700, ai_tail=1800):
    out = []
    for t in turns:
        out.append(f"### Turn {t.idx}\nUSER: {clip(t.human, human_max, 0)}")
        if t.assistant:
            out.append(f"AI: {clip(t.assistant, ai_head, ai_tail)}")
    return "\n\n".join(out)


def find_anchor(turns, fragment, occurrence="last"):
    """Index of the human turn containing `fragment` (case-insensitive)."""
    norm = lambda s: " ".join(s.lower().replace("’", "'").split())
    frag = norm(fragment)
    hits = [t.idx for t in turns if frag in norm(t.human)]
    if not hits:
        return None
    return hits[-1] if occurrence == "last" else hits[0]
