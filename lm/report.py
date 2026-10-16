"""Turn results.json into a scorecard (markdown + HTML with the boards)."""
import html
import json
import pathlib
from collections import defaultdict
from statistics import mean

TEXT_CONDS = ["ai", "ledger+recent", "ledger", "recent"]
GLANCE_CONDS = ["board", "board@glance", "list", "list@glance"]


def _usage_by_transcript(cache="cache/usage.jsonl"):
    """Extraction output tokens and real cost, from calls without CLI overhead."""
    last = {}
    for line in open(cache):
        u = json.loads(line)
        if u["tag"].startswith("extract:") and u["input_tokens"] < 50_000:
            last[u["tag"]] = u
    agg = defaultdict(lambda: {"windows": 0, "output_tokens": 0, "cost_usd": 0.0})
    for tag, u in last.items():
        a = agg[tag.split(":")[1]]
        a["windows"] += 1
        a["output_tokens"] += u["output_tokens"]
        a["cost_usd"] += u["cost_usd"]
    return agg


def build(out="out", ver="v1"):
    out = pathlib.Path(out)
    d = json.loads((out / "results.json").read_text())
    R, B, X = d["results"], d["boards"], d["extraction"]
    usage = _usage_by_transcript()

    def avg(cond, key="score", t=None):
        xs = [r[key] for r in R if r["cond"] == cond and (t is None or r["t"] == t)]
        return mean(xs) if xs else float("nan")

    ts = sorted({r["t"] for r in R})
    md = [f"# Living Map v0 — scorecard ({ver})", ""]
    md.append(f"{len({r['probe'] for r in R if not r['probe'].startswith('ov-')})} probes across {len(ts)} real chats; each probe is a 'what is settled?' "
              "question asked at the turn where the user actually lost the thread. Scores: 1 right, 0.5 partial, 0 wrong/unknown.")
    md += ["", "## 1 · Does the ledger remember what is settled?", "",
           "| Context the model had | Score | Context size (tokens) |", "|---|---|---|"]
    names = {"ai": "What Claude had (compaction summary + turns since)", "ledger+recent": "Ledger + last 6 turns",
             "ledger": "Ledger alone", "recent": "Last 6 turns alone"}
    for c in TEXT_CONDS:
        md.append(f"| {names[c]} | **{avg(c):.2f}** | {avg(c, 'ctx_tokens'):,.0f} |")
    md += ["", "| Chat | " + " | ".join(TEXT_CONDS) + " |", "|---|" + "---|" * len(TEXT_CONDS)]
    for t in ts:
        md.append(f"| {t} | " + " | ".join(f"{avg(c, t=t):.2f}" for c in TEXT_CONDS) + " |")

    md += ["", "## 2 · Can it be read off the picture?", "",
           "Answers from a screenshot only. *@glance* = shrunk to 900px wide, so only large type and visual cues survive.", "",
           "| View | Score |", "|---|---|"]
    for c in GLANCE_CONDS:
        md.append(f"| {c} | **{avg(c):.2f}** |")
    md += ["", "Overview probes (gold read from the ledger itself, so this isolates the drawing):", "",
           "| View | Score |", "|---|---|"]
    for c in ["ov-board", "ov-board@glance", "ov-list", "ov-list@glance"]:
        md.append(f"| {c} | **{avg(c):.2f}** |")
    ls = mean(b["lint_score"] for b in B)
    fails = defaultdict(int)
    for b in B:
        for k, ok in b["checks"].items():
            fails[k] += (not ok)
    md += ["", f"Perception lint (board rules from the research): **{ls:.2f}** of checks passed on average.", ""]
    md += [f"- {k}: failed on {v} of {len(B)} boards" for k, v in fails.items() if v]

    md += ["", "## 3 · What does it cost?", "", "| Chat | Turns | Extract prompt tokens / turn | Extract output tokens / turn | Ledger size (tokens) | Items | Cost / 100 turns |", "|---|---|---|---|---|---|---|"]
    for t in ts:
        x, u = X[t], usage.get(t if ver == "v1" else f"{ver}-{t}", {})
        per_turn_out = u.get("output_tokens", 0) / max(x["turns"], 1)
        cost100 = u.get("cost_usd", 0) / max(x["turns"], 1) * 100
        md.append(f"| {t} | {x['turns']} | {x['prompt_tokens_per_turn']:,} | {per_turn_out:,.0f} | "
                  f"{x['ledger_tokens_final']:,} | {x['items_final']} | ${cost100:.2f} |")

    ai_ctx, led_ctx = avg("ai", "ctx_tokens"), avg("ledger+recent", "ctx_tokens")
    md += ["", "## Headline", "",
           f"- Capture: ledger+recent scores **{avg('ledger+recent'):.2f}** vs **{avg('ai'):.2f}** for what Claude had.",
           f"- Context: **{ai_ctx / max(led_ctx, 1):.1f}× smaller** ({led_ctx:,.0f} vs {ai_ctx:,.0f} tokens).",
           f"- Glance, detail probes: board **{avg('board@glance'):.2f}** vs plain list **{avg('list@glance'):.2f}** at glance size.",
           f"- Glance, overview probes: board **{avg('ov-board@glance'):.2f}** vs plain list **{avg('ov-list@glance'):.2f}** at glance size.",
           "", "## Every probe", "", "| Probe | ai | ledger+recent | ledger | board@glance | list@glance |",
           "|---|---|---|---|---|---|"]
    by = defaultdict(dict)
    for r in R:
        if not r["probe"].startswith("ov-"):
            by[r["probe"]][r["cond"]] = r["score"]
    for pid, s in by.items():
        md.append(f"| {pid} | " + " | ".join(f"{s.get(c, '')}" for c in
                                             ["ai", "ledger+recent", "ledger", "board@glance", "list@glance"]) + " |")
    md += ["", "## Misses (ledger+recent scored below 1)", ""]
    for r in R:
        if r["cond"] == "ledger+recent" and r["score"] < 1:
            md.append(f"- **{r['probe']}** ({r['score']}): {r['answer'][:220]} — *{r['why'][:200]}*")
    (out / "scorecard.md").write_text("\n".join(md))

    # HTML: the scorecard plus the board at each chat's latest probe
    latest = {}
    for b in B:
        if b["t"] not in latest or b["turn"] > latest[b["t"]]["turn"]:
            latest[b["t"]] = b
    imgs = "".join(f'<h3>{html.escape(t)} — turn {b["turn"]}</h3>'
                   f'<img src="{pathlib.Path(b["png"]).relative_to(out.resolve()) if pathlib.Path(b["png"]).is_absolute() else pathlib.Path(b["png"]).relative_to(out)}" style="width:100%;border:1px solid #ddd">'
                   for t, b in sorted(latest.items()))
    body = "<br>".join(html.escape(l) for l in md)
    (out / "scorecard.html").write_text(
        f"<!doctype html><meta charset='utf-8'><title>Living Map v0 scorecard</title>"
        f"<body style='font:15px/1.5 -apple-system,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px'>"
        f"<div style='white-space:normal'>{body}</div><h2>The boards</h2>{imgs}</body>")
    return "\n".join(md)
