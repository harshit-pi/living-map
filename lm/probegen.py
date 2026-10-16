"""Grow the probe set from the transcripts themselves.

1. generate: a strong model reads ~25-turn segments and proposes settled
   decisions and rules a person would need later, each with the turn that
   settled it (the evidence turn).
2. anchor: each probe is asked later, just after the next compaction when there
   is one (that is where the AI forgets), otherwise 20 turns on.
3. verify: a second pass reads the evidence turn and every turn up to the
   anchor, and keeps the probe only if the gold still holds at the anchor —
   correcting it when the decision changed later.

The generator never sees a ledger, so the gold is independent of what is
being scored.
"""
import re

from . import llm
from .transcripts import clip, render_turns

SEGMENT = 25

GEN_SYS = """You build a test set for a memory system for long AI work sessions. From the transcript segment, list what the USER settled that someone would plausibly need to recall much later: a decision between options (tool, model, datastore, scope, number, approach), a standing rule or preference ("always…", "never…", "use X"), or a deferral/rejection.

Rules:
- Only things the user decided or accepted. An AI proposal the user never accepted does not count.
- Specific and checkable: the gold names the thing, value or number. No file-level edits, no debugging steps, no transient errors, no trivia.
- The question must not reveal the answer and must make sense on its own months later ("Which datastore holds ingestion state?", not "What did we pick?").
- Each question asks exactly ONE thing.
- gold: the core answer only, at most 20 words. evidence_turn: the turn index where it was settled.
- Return 0-4 items; fewer, better items beat many weak ones."""

GEN_SCHEMA = {"type": "object", "properties": {"items": {"type": "array", "items": {
    "type": "object", "properties": {
        "q": {"type": "string"}, "gold": {"type": "string"},
        "evidence_turn": {"type": "integer"},
        "kind": {"type": "string", "enum": ["decision", "rule", "deferral"]}},
    "required": ["q", "gold", "evidence_turn", "kind"]}}}, "required": ["items"]}

VERIFY_SYS = """You check one test question against a transcript. You get the turn where a decision was supposedly settled and every later turn up to the moment the question is asked (later turns are clipped).

Decide:
- valid: the evidence really shows the user settling this (not just an AI proposal), and the question has one clear answer at the moment it is asked.
- gold_at_anchor: the correct answer AT THE MOMENT OF ASKING. If a later turn changed the decision, give the new answer and set changed_later true.
- user_quote: the user's own words (verbatim, at most 20 words) that settle or accept it, from the evidence or a later turn. If the user never said anything that settles it, leave it empty and set valid false.
- gold_at_anchor: the core answer only, at most 20 words.
- Reject (valid false) anything ambiguous, trivial, compound (two questions in one), or not actually settled by the user."""

VERIFY_SCHEMA = {"type": "object", "properties": {
    "valid": {"type": "boolean"}, "user_quote": {"type": "string"}, "gold_at_anchor": {"type": "string"},
    "changed_later": {"type": "boolean"}, "reason": {"type": "string"}},
    "required": ["valid", "user_quote", "gold_at_anchor", "changed_later", "reason"]}


def generate(chat, turns, upto):
    cands = []
    for start in range(0, upto, SEGMENT):
        seg = turns[start:min(start + SEGMENT, upto)]
        r = llm.call(f"TRANSCRIPT SEGMENT (turns {seg[0].idx}-{seg[-1].idx}):\n\n{render_turns(seg)}",
                     GEN_SYS, model="sonnet", schema=GEN_SCHEMA, tag=f"probegen:{chat}:{start}")
        for it in r["structured"].get("items", []):
            if seg[0].idx <= it["evidence_turn"] <= seg[-1].idx:
                cands.append(it)
    return cands


def anchor_for(evidence, compactions, n_turns, cap):
    """Ask just after the next compaction (where the AI forgets), else +20."""
    nxt = [c.before_turn for c in compactions if c.before_turn > evidence + 1]
    a = nxt[0] + 2 if nxt else evidence + 20
    a = min(a, cap, n_turns - 1)
    if a <= evidence + 6:
        return None, False
    return a, bool(nxt) and nxt[0] <= a


def verify(chat, cand, turns, anchor):
    ev = turns[cand["evidence_turn"]]
    evidence = render_turns([ev], human_max=2500, ai_head=1200, ai_tail=1800)
    later = render_turns(turns[ev.idx + 1:anchor], human_max=500, ai_head=250, ai_tail=350)
    prompt = (f"QUESTION (asked at turn {anchor}): {cand['q']}\nPROPOSED GOLD: {cand['gold']}\n\n"
              f"EVIDENCE TURN:\n{evidence}\n\nLATER TURNS UP TO {anchor}:\n{later}")
    r = llm.call(prompt, VERIFY_SYS, model="sonnet", schema=VERIFY_SCHEMA,
                 tag=f"probeverify:{chat}:{ev.idx}")
    return r["structured"]


def _words(s):
    return set(re.findall(r"[a-z0-9]+", s.lower())) - {"the", "a", "an", "of", "to", "for", "is", "what", "which", "in", "on", "and", "or", "does", "do", "how"}


def dedupe(probes):
    kept = []
    for p in probes:
        w = _words(p["q"] + " " + p["gold"])
        if all(len(w & _words(k["q"] + " " + k["gold"])) / max(1, len(w | _words(k["q"] + " " + k["gold"]))) < 0.5
               for k in kept):
            kept.append(p)
    return kept


def spread(probes, n):
    """Pick n probes spread across the chat, preferring ones that cross a compaction."""
    probes = sorted(probes, key=lambda p: (not p["crosses_compaction"], p["evidence_turn"]))
    preferred = [p for p in probes if p["crosses_compaction"]]
    rest = [p for p in probes if not p["crosses_compaction"]]
    out = []
    for pool in (preferred, rest):
        pool = sorted(pool, key=lambda p: p["evidence_turn"])
        while pool and len(out) < n:
            step = max(1, len(pool) // max(1, n - len(out)))
            take = pool[::step][: n - len(out)]
            out += take
            pool = [p for p in pool if p not in take]
    return sorted(out, key=lambda p: p["evidence_turn"])


def clip_q(s):
    return clip(s, 300, 0)
