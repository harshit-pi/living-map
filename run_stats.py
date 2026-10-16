"""Which differences are real? Bootstrap CIs and paired version comparisons on
the v2 probe set -> out/stats_p2.md

usage: python3 -I run_stats.py [tag]      (reads out/<ver>/<tag>/results.json)
"""
import json
import pathlib
import random
import sys
from itertools import combinations
from statistics import mean, pstdev

TAG = sys.argv[1] if len(sys.argv) > 1 else "p2"
B = 4000
rng = random.Random(11)


def scores(results, cond, source=None):
    return {r["probe"]: r["score"] for r in results
            if r["cond"] == cond and (source is None or r.get("source") == source)}


def ci(xs):
    if not xs:
        return float("nan"), float("nan"), float("nan")
    boots = sorted(mean(rng.choices(xs, k=len(xs))) for _ in range(B))
    return mean(xs), boots[int(.025 * B)], boots[int(.975 * B)]


def paired(a, b):
    """mean(a-b) over probes both have, with a bootstrap CI."""
    keys = sorted(set(a) & set(b))
    d = [a[k] - b[k] for k in keys]
    m, lo, hi = ci(d)
    return m, lo, hi, len(d), (pstdev(d) if d else 0)


def fmt(m, lo, hi):
    return f"{m:.2f} [{lo:.2f}, {hi:.2f}]"


def main():
    vers = sorted(p.parent.parent.name for p in pathlib.Path("out").glob(f"v*/{TAG}/results.json"))
    R = {v: json.loads(pathlib.Path(f"out/{v}/{TAG}/results.json").read_text())["results"] for v in vers}
    n = len({r["probe"] for r in R[vers[0]] if r.get("source") != "overview"})
    md = [f"# Living Map — what is measurable ({TAG}, {n} probes)", "",
          "Mean score with a 95% bootstrap interval over probes. Judge: "
          "Haiku (agrees with Sonnet within half a point on 208/208 grades).", "",
          "## Every condition", "", "| Condition | " + " | ".join(vers) + " |", "|---|" + "---|" * len(vers)]
    for cond in ["ai", "ledger+recent", "ledger", "recent", "board@glance", "list@glance",
                 "ov-board@glance", "ov-list@glance"]:
        md.append(f"| {cond} | " + " | ".join(fmt(*ci(list(scores(R[v], cond).values()))) for v in vers) + " |")

    md += ["", "## Ledger vs what Claude had (paired, same probes)", "",
           "| Version | ledger − ai | ledger+recent − ai |", "|---|---|---|"]
    for v in vers:
        a, l, lr = scores(R[v], "ai"), scores(R[v], "ledger"), scores(R[v], "ledger+recent")
        md.append(f"| {v} | {fmt(*paired(l, a)[:3])} | {fmt(*paired(lr, a)[:3])} |")

    md += ["", "## Version vs version (paired, ledger alone)", "",
           "A difference is real when its interval excludes 0.", "",
           "| Pair | Difference | Real? | Smallest detectable gap |", "|---|---|---|---|"]
    for v1, v2 in combinations(vers, 2):
        m, lo, hi, k, sd = paired(scores(R[v2], "ledger"), scores(R[v1], "ledger"))
        mde = 2.8 * sd / max(k, 1) ** .5
        md.append(f"| {v2} − {v1} | {fmt(m, lo, hi)} | {'yes' if lo > 0 or hi < 0 else 'no'} | ±{mde:.2f} |")

    md += ["", "## By probe source (ledger alone)", "", "| Source | " + " | ".join(vers) + " |",
           "|---|" + "---|" * len(vers)]
    for src in ["lost-thread", "generated"]:
        md.append(f"| {src} | " + " | ".join(fmt(*ci(list(scores(R[v], 'ledger', src).values()))) for v in vers) + " |")
    md += ["", "## Board vs list at glance size (paired)", "", "| Version | detail probes | overview probes |", "|---|---|---|"]
    for v in vers:
        d1 = paired(scores(R[v], "board@glance"), scores(R[v], "list@glance"))
        d2 = paired(scores(R[v], "ov-board@glance"), scores(R[v], "ov-list@glance"))
        md.append(f"| {v} | {fmt(*d1[:3])} | {fmt(*d2[:3])} |")
    pathlib.Path(f"out/stats_{TAG}.md").write_text("\n".join(md))
    print("\n".join(md))


if __name__ == "__main__":
    main()
