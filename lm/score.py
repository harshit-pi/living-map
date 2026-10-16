"""Score the ledger against the moments the user actually lost the thread.

For every probe (a question asked at the anchor turn where the user got lost)
we answer it from four contexts and grade each answer against the gold:

  ai             what Claude really had: the last compaction summary + prose
                 turns since (tool output excluded, so this flatters Claude)
  ledger+recent  our product after a fresh start: ledger + last 6 turns
  ledger         the ledger alone
  recent         last 6 turns alone (the floor)

Then the glance test: the same questions answered from a screenshot only —
the board vs the same ledger as a plain list, each at full size and shrunk to
a glance size where only large type and visual cues survive.
"""
import hashlib
import json
import os
import pathlib
from concurrent.futures import ThreadPoolExecutor

from . import llm, render
from . import transcripts as T
from .extract import snapshot_before
from .ledger import Ledger

RECENT = 6
GLANCE_WIDTH = 900
AI_CTX_CAP = 400_000  # chars

ANSWER_SYS = ("You answer questions about a work session between a user and an AI agent, using ONLY the context given. "
              "If the context does not contain the answer, reply exactly: unknown. Answer in one or two sentences.")
GLANCE_SYS = ("You are shown a screenshot of a status board. Use ONLY what is visible in the image. "
              "If the answer is not visible or not legible, reply exactly: unknown. Answer in one or two sentences.")
JUDGE_SYS = ("You grade an answer against a gold answer about what was decided in a work session.\n"
             "1 = states the same decision or status as the gold (wording may differ; extra correct detail is fine).\n"
             "0.5 = partly right: right direction but missing the key specific, or hedged between options.\n"
             "0 = wrong, contradicts the gold, or 'unknown'.")
JUDGE_SCHEMA = {"type": "object", "properties": {
    "score": {"type": "number", "enum": [0, 0.5, 1]}, "reason": {"type": "string"}},
    "required": ["score", "reason"]}


def overview_probes(led, chat, turn):
    """Questions a board should answer at a glance; gold is read from the
    ledger, so these isolate rendering quality from extraction quality."""
    items = list(led.items.values())
    waiting = [i for i in items if i["status"] == "waiting"]
    open_ = [i for i in items if i["status"] == "open"]
    decided = sorted([i for i in items if i["status"] == "decided"], key=lambda i: -i["turn"])
    changed = sorted([i for i in items if Ledger.prior_values(i) and i["status"] != "dropped"], key=lambda i: -i["turn"])
    dropped = [i for i in items if i["status"] == "dropped"]
    base = f"ov-{chat}-t{turn}"
    out = [
        {"id": f"{base}-nwait", "t": chat, "q": "How many items are waiting on the user?", "gold": str(len(waiting))},
        {"id": f"{base}-nopen", "t": chat, "q": "How many items are open?", "gold": str(len(open_))},
        {"id": f"{base}-thread", "t": chat, "q": "Which workstream was most recently active?", "gold": led.threads()[0] if items else "none"},
    ]
    if waiting:
        out.append({"id": f"{base}-wait", "t": chat, "q": "Name the items waiting on the user.",
                    "gold": "; ".join(i["title"] for i in waiting)})
    if decided:
        i = decided[0]
        out.append({"id": f"{base}-dec", "t": chat, "q": f"What is the current decision for '{i['title']}'?", "gold": i["value"]})
    if changed:
        i = changed[0]
        out.append({"id": f"{base}-was", "t": chat, "q": f"What did '{i['title']}' change from?",
                    "gold": " → ".join(Ledger.prior_values(i))})
    if dropped:
        out.append({"id": f"{base}-drop", "t": chat, "q": "Name one item that was dropped.",
                    "gold": "any one of: " + "; ".join(i["title"] for i in dropped)})
    return out


def load_snaps(outdir):
    snaps = {0: Ledger()}
    for f in sorted(pathlib.Path(outdir).glob("ledger_t*.json")):
        snaps[int(f.stem.split("_t")[1])] = Ledger.from_json(f.read_text())
    return snaps


JUDGE_MODEL = os.environ.get("LM_JUDGE", "sonnet")


def judge(q, gold, answer, tag, model=None):
    r = llm.call(f"QUESTION: {q}\nGOLD: {gold}\nANSWER: {answer}", JUDGE_SYS, model=model or JUDGE_MODEL,
                 schema=JUDGE_SCHEMA, tag=f"judge:{tag}")
    return r["structured"]["score"], r["structured"]["reason"]


def text_task(p, cond, ctx):
    a = llm.call(f"CONTEXT:\n{ctx}\n\nQUESTION: {p['q']}", ANSWER_SYS, model="haiku", tag=f"answer:{p['id']}:{cond}")
    s, why = judge(p["q"], p["gold"], a["text"], f"{p['id']}:{cond}")
    return {"probe": p["id"], "t": p["t"], "cond": cond, "ctx_tokens": llm.approx_tokens(ctx),
            "source": p.get("source", "overview"), "crosses": p.get("crosses_compaction"),
            "answer": a["text"], "score": s, "why": why}


def glance_task(p, cond, png):
    digest = hashlib.sha256(png.read_bytes()).hexdigest()[:10]
    a = llm.call(f"Read the image at {png} (version {digest}), then answer: {p['q']}", GLANCE_SYS, model="haiku",
                 tag=f"glance:{p['id']}:{cond}", read_dir=png.parent)
    s, why = judge(p["q"], p["gold"], a["text"], f"{p['id']}:{cond}")
    return {"probe": p["id"], "t": p["t"], "cond": cond, "answer": a["text"], "score": s, "why": why,
            "source": p.get("source", "overview"), "crosses": p.get("crosses_compaction")}


def run(probes_path="data/probes.json", out="out", ledgers=None, lean=False):
    P = json.load(open(probes_path))
    out = pathlib.Path(out).resolve()
    tasks, boards, extraction = [], [], {}
    for name, path in P["transcripts"].items():
        turns, comps = T.load(os.path.expanduser(path))
        snaps = load_snaps(pathlib.Path(ledgers or out).resolve() / name)
        extraction[name] = extraction_cost(turns, snaps)
        last_anchor = max(x.get("anchor_turn") or T.find_anchor(turns, x["anchor"]) for x in P["probes"] if x["t"] == name)
        for p in [x for x in P["probes"] if x["t"] == name]:
            A = p.get("anchor_turn") or T.find_anchor(turns, p["anchor"])
            led = snapshot_before(snaps, A)
            recent = T.render_turns(turns[max(0, A - RECENT):A])
            comp = max((c for c in comps if c.before_turn <= A), key=lambda c: c.before_turn, default=None)
            since = comp.before_turn if comp else 0
            ai = ((f"SUMMARY OF EARLIER CONVERSATION:\n{comp.summary}\n\n" if comp else "")
                  + T.render_turns(turns[since:A]))[-AI_CTX_CAP:]
            ctxs = {"ai": ai, "ledger+recent": f"{led.to_text()}\n\nRECENT TURNS:\n{recent}",
                    "ledger": led.to_text(), "recent": recent}
            for cond, ctx in ctxs.items():
                tasks.append(("text", p, cond, ctx))
            # glance renders
            d = out / "png" / name
            d.mkdir(parents=True, exist_ok=True)
            bh, bheight, lint = render.board_html(led, A, recent_from=max(0, A - RECENT))
            lh, lheight = render.list_html(led)
            bpng = render.screenshot(bh, d / f"board_t{A:03d}.png", bheight)
            lpng = render.screenshot(lh, d / f"list_t{A:03d}.png", lheight)
            bs = render.downscale(bpng, GLANCE_WIDTH, d / f"board_t{A:03d}_glance.png")
            ls = render.downscale(lpng, GLANCE_WIDTH, d / f"list_t{A:03d}_glance.png")
            views = [("board@glance", bs), ("list@glance", ls)] if lean else \
                [("board", bpng), ("board@glance", bs), ("list", lpng), ("list@glance", ls)]
            for cond, png in views:
                tasks.append(("glance", p, cond, png))
            if A == last_anchor:
                for op in overview_probes(led, name, A):
                    for cond, png in [("ov-board", bpng), ("ov-board@glance", bs), ("ov-list", lpng), ("ov-list@glance", ls)]:
                        tasks.append(("glance", op, cond, png))
            ls_score, checks = render.lint_score(lint)
            boards.append({"probe": p["id"], "t": name, "turn": A, "png": str(bpng), "lint": lint,
                           "lint_score": ls_score, "checks": checks, "ledger_tokens": llm.approx_tokens(led.to_text())})

    def do(t):
        kind, p, cond, x = t
        return text_task(p, cond, x) if kind == "text" else glance_task(p, cond, x)

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(do, tasks))
    data = {"results": results, "boards": boards, "extraction": extraction}
    (out / "results.json").write_text(json.dumps(data, indent=1))
    return data


def extraction_cost(turns, snaps):
    """Tokens the product would actually send to extract (prompt estimate),
    rebuilt from the saved snapshots so CLI overhead never pollutes it."""
    from .extract import SYSTEM
    keys = sorted(snaps)
    sent = 0
    for a, b in zip(keys, keys[1:]):
        prompt = snaps[a].to_prompt() + T.render_turns(turns[a:b])
        sent += llm.approx_tokens(SYSTEM + prompt)
    n = keys[-1] if keys else 0
    final = snaps[keys[-1]]
    return {"turns": n, "prompt_tokens_total": sent, "prompt_tokens_per_turn": round(sent / max(n, 1)),
            "ledger_tokens_final": llm.approx_tokens(final.to_text()), "items_final": len(final.items)}
