"""Does a Haiku judge agree with the Sonnet judge? Re-grades every answer in
out/<ver>/results.json with Haiku and reports agreement."""
import json, os, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lm import score

ver = sys.argv[1] if len(sys.argv) > 1 else "v4"
P = {p["id"]: p for p in json.load(open("data/probes.json"))["probes"]}
R = [r for r in json.load(open(f"out/{ver}/results.json"))["results"] if r["probe"] in P]

def regrade(r):
    p = P[r["probe"]]
    s, _ = score.judge(p["q"], p["gold"], r["answer"], f"{r['probe']}:{r['cond']}", model="haiku")
    return r["score"], s

with ThreadPoolExecutor(8) as ex:
    pairs = list(ex.map(regrade, R))
exact = sum(a == b for a, b in pairs) / len(pairs)
within = sum(abs(a - b) <= 0.5 for a, b in pairs) / len(pairs)
mean_s = sum(a for a, _ in pairs) / len(pairs); mean_h = sum(b for _, b in pairs) / len(pairs)
print(f"{len(pairs)} grades · exact agreement {exact:.2f} · within half a point {within:.2f} · "
      f"mean sonnet {mean_s:.3f} vs haiku {mean_h:.3f}")
flips = [(a, b) for a, b in pairs if abs(a - b) == 1]
print("full flips (0<->1):", len(flips))
