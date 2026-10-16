"""Side-by-side scores for every scored version -> out/compare.md"""
import json
import pathlib
from statistics import mean

ROWS = [
    ("Capture: what Claude had", "ai", "score"),
    ("Capture: ledger + last 6 turns", "ledger+recent", "score"),
    ("Capture: ledger alone", "ledger", "score"),
    ("Capture: last 6 turns alone", "recent", "score"),
    ("Glance detail: board", "board", "score"),
    ("Glance detail: board @900px", "board@glance", "score"),
    ("Glance detail: list", "list", "score"),
    ("Glance detail: list @900px", "list@glance", "score"),
    ("Glance overview: board", "ov-board", "score"),
    ("Glance overview: board @900px", "ov-board@glance", "score"),
    ("Glance overview: list", "ov-list", "score"),
    ("Glance overview: list @900px", "ov-list@glance", "score"),
    ("Context tokens: what Claude had", "ai", "ctx_tokens"),
    ("Context tokens: ledger + last 6", "ledger+recent", "ctx_tokens"),
]


def main():
    vers = sorted(p.parent.name for p in pathlib.Path("out").glob("v*/results.json"))
    data = {v: json.loads(pathlib.Path(f"out/{v}/results.json").read_text()) for v in vers}
    md = ["# Living Map — versions compared", "", "| Metric | " + " | ".join(vers) + " |",
          "|---|" + "---|" * len(vers)]
    for label, cond, key in ROWS:
        cells = []
        for v in vers:
            xs = [r[key] for r in data[v]["results"] if r["cond"] == cond and key in r]
            cells.append(("—" if not xs else (f"{mean(xs):,.0f}" if key == "ctx_tokens" else f"{mean(xs):.2f}")))
        md.append(f"| {label} | " + " | ".join(cells) + " |")
    for label, fn in [("Perception lint", lambda d: mean(b["lint_score"] for b in d["boards"])),
                      ("Threads per chat (final)", lambda d: mean(b["lint"]["threads_total"] for b in d["boards"])),
                      ("Items hidden on board", lambda d: mean(b["lint"]["items_hidden"] for b in d["boards"])),
                      ("Ledger tokens (final, avg)", lambda d: mean(x["ledger_tokens_final"] for x in d["extraction"].values())),
                      ("Extract prompt tokens / turn", lambda d: mean(x["prompt_tokens_per_turn"] for x in d["extraction"].values()))]:
        md.append(f"| {label} | " + " | ".join(f"{fn(data[v]):,.2f}" for v in vers) + " |")
    pathlib.Path("out/compare.md").write_text("\n".join(md))
    print("\n".join(md))


if __name__ == "__main__":
    main()
