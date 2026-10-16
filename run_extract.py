"""Build ledgers for every transcript up to its last probe anchor.

usage: python3 -I run_extract.py [v1..v4] [probes.json]   -> out/<ver>/<chat>/ledger_tNNN.json
"""
import json, os, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lm import transcripts as T, extract as E

VER = sys.argv[1] if len(sys.argv) > 1 else "v1"
PROBES = sys.argv[2] if len(sys.argv) > 2 else "data/probes.json"
P = json.load(open(PROBES))

def one(name):
    turns, _ = T.load(os.path.expanduser(P["transcripts"][name]))
    anchors = [p.get("anchor_turn") or T.find_anchor(turns, p["anchor"]) for p in P["probes"] if p["t"] == name]
    upto = max(a for a in anchors if a is not None)
    tag = name if VER == "v1" else f"{VER}-{name}"
    snaps, spend = E.build(tag, turns, upto, f"out/{VER}/{name}", system=E.PROMPTS[VER], schema=E.SCHEMAS[VER])
    return name, len(snaps[max(snaps)].items), spend

if __name__ == "__main__":
    with ThreadPoolExecutor(8) as ex:
        for name, n, spend in ex.map(one, P["transcripts"]):
            print(name, n, "items", spend, flush=True)
