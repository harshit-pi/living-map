"""Grow data/probes.json (26 lost-thread probes) into data/probes_v2.json.

usage: python3 -I run_probegen.py
"""
import json
import os
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lm import probegen as G
from lm import transcripts as T

PER_CHAT = 12
CAP = 220  # never anchor past this turn: keeps extraction bounded on huge chats
# Extra chats to generate probes from: {"name": "~/.claude/projects/<dir>/<session>.jsonl"},
# kept in an ignored local file because transcript paths name private projects.
NEW = json.load(open("data/new_chats.json")) if pathlib.Path("data/new_chats.json").exists() else {}


def one(item):
    chat, path = item
    turns, comps = T.load(os.path.expanduser(path))
    upto = min(len(turns), CAP)
    cands = G.generate(chat, turns, upto)
    out, stats = [], {"candidates": len(cands), "no_anchor": 0, "rejected": 0, "changed_later": 0}
    for c in cands:
        a, crosses = G.anchor_for(c["evidence_turn"], comps, len(turns), CAP)
        if a is None:
            stats["no_anchor"] += 1
            continue
        v = G.verify(chat, c, turns, a)
        if not v["valid"] or not v.get("user_quote", "").strip():
            stats["rejected"] += 1
            continue
        stats["changed_later"] += v["changed_later"]
        out.append({"t": chat, "q": c["q"], "gold": v["gold_at_anchor"], "gold_proposed": c["gold"],
                    "kind": c["kind"], "evidence_turn": c["evidence_turn"], "anchor_turn": a,
                    "crosses_compaction": crosses, "changed_later": v["changed_later"],
                    "verify_reason": v["reason"], "user_quote": v["user_quote"], "source": "generated"})
    picked = G.spread(G.dedupe(out), PER_CHAT)
    stats["verified"], stats["picked"] = len(out), len(picked)
    return chat, picked, stats


def main():
    P = json.load(open("data/probes.json"))
    chats = {**P["transcripts"], **NEW}
    old = [{**p, "source": "lost-thread"} for p in P["probes"]]
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(one, chats.items()))
    new = []
    for chat, picked, stats in res:
        print(chat, stats, flush=True)
        for i, p in enumerate(picked):
            new.append({"id": f"g-{chat}-{i:02d}", **p})
    out = {"_about": "v2 probe set: 26 lost-thread probes (asked where the user lost the thread) plus generated "
                     "probes, each verified against the transcript up to its anchor turn (gold = answer at the anchor).",
           "transcripts": chats, "probes": old + new}
    json.dump(out, open("data/probes_v2.json", "w"), indent=1, ensure_ascii=False)
    print("total probes", len(old) + len(new), "generated", len(new))


if __name__ == "__main__":
    main()
