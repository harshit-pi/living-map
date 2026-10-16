"""Score ledgers and write a scorecard.

usage: python3 -I run_score.py v4 [--probes data/probes_v2.json --tag p2 --lean] [--report-only]
       results go to out/<ver>/ (or out/<ver>/<tag>/ with --tag)
"""
import os, sys, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lm import score, report

if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("ver"); a.add_argument("--probes", default="data/probes.json")
    a.add_argument("--tag", default=""); a.add_argument("--lean", action="store_true")
    a.add_argument("--report-only", action="store_true")
    x = a.parse_args()
    out = f"out/{x.ver}" + (f"/{x.tag}" if x.tag else "")
    if not x.report_only:
        score.run(probes_path=x.probes, out=out, ledgers=f"out/{x.ver}", lean=x.lean)
    print(report.build(out=out, ver=x.ver))
