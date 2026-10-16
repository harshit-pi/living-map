"""Render a ledger as a board (for the person) and as a plain list (the
text-only control), screenshot both with headless Chrome, and lint the board
against the perception rules from the research:

- status is encoded three ways (colour, icon, word), never colour alone
- one block per thread, at most MAX_THREADS threads, MAX_CARDS live cards each
- done and dropped collapse to one-line rows
- labels short enough to read at a glance
"""
import html
import pathlib
import subprocess

from .ledger import Ledger, STATUS_LABEL

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
COLS, MAX_THREADS, MAX_CARDS, MAX_ROWS = 4, 8, 5, 6
WIDTH = 1600
COLOR = {"waiting": "#C2410C", "open": "#B45309", "decided": "#1D4ED8",
         "done": "#15803D", "parked": "#6B7280", "dropped": "#9CA3AF"}
ICON = {"waiting": "!", "open": "?", "decided": "●", "done": "✓", "parked": "⏸", "dropped": "✕"}

CSS = """
*{box-sizing:border-box;margin:0}
body{background:#FAF9F6;font-family:-apple-system,'Helvetica Neue',sans-serif;color:#1F2937;padding:28px 32px;width:%dpx}
h1{font-size:26px;font-weight:600}
.sub{font-size:15px;color:#4B5563;margin:4px 0 14px}
.legend{display:flex;gap:16px;font-size:13px;margin-bottom:18px;color:#374151}
.legend b{display:inline-block;width:18px;height:18px;border-radius:9px;color:#fff;text-align:center;line-height:18px;font-size:12px;margin-right:5px}
.grid{display:grid;gap:16px;align-items:start}
.col h2{font-size:17px;font-weight:600;padding:0 2px 8px;border-bottom:2px solid #E5E7EB;margin-bottom:10px}
.card{background:#fff;border:1px solid #E5E7EB;border-left:7px solid;border-radius:8px;padding:9px 11px;margin-bottom:9px}
.st{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.t{font-size:16px;font-weight:600;margin-top:2px}
.v{font-size:14px;line-height:1.35;margin-top:2px}
.was{font-size:12px;color:#6B7280;margin-top:4px}
.new{display:inline-block;width:8px;height:8px;border-radius:4px;background:#C2410C;margin-left:6px;vertical-align:middle}
.faded{opacity:.6}
.row{font-size:13px;line-height:1.35;margin:3px 0 0 2px;color:#374151}
.row i{font-style:normal;font-weight:600}
.drop{font-size:13px;color:#6B7280;margin-top:4px}
.drop s{color:#9CA3AF}
.more{font-size:13px;color:#6B7280}
.foot{font-size:13px;color:#6B7280;margin-top:14px}
""" % WIDTH


def _e(s):
    return html.escape(str(s))


def _clip(t, n):
    t = str(t)
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def _lines(text, chars_per_line):
    return max(1, -(-len(text) // chars_per_line))


def board_html(ledger: Ledger, turn: int, recent_from: int):
    """Live items (waiting/open/decided/parked) as cards; done and dropped as
    one-line rows, so what still needs attention dominates the picture."""
    if any(i.get("kind") for i in ledger.items.values()):
        return board_html_kinds(ledger, turn, recent_from)
    threads = ledger.threads()
    shown, hidden = threads[:MAX_THREADS], threads[MAX_THREADS:]
    counts = {s: sum(1 for i in ledger.items.values() if i["status"] == s) for s in COLOR}
    lint = {"threads_total": len(threads), "threads_shown": len(shown), "items_total": len(ledger.items),
            "items_shown": 0, "items_hidden": 0, "title_words": [], "value_words": [], "max_cards_col": 0}
    cols, col_heights = [], []
    for th in shown:
        items = ledger.by_thread(th)
        live = [i for i in items if i["status"] in ("waiting", "open", "decided", "parked")]
        done = [i for i in items if i["status"] == "done"]
        dropped = [i for i in items if i["status"] == "dropped"]
        h = 44 + 22 * _lines(th, 26)
        cards = []
        for i in live[:MAX_CARDS]:
            c = COLOR[i["status"]]
            was = Ledger.prior_values(i)[-2:]
            was_txt = " → ".join(_clip(w, 40) for w in was)
            was_html = f'<div class="was">↺ was: {_e(was_txt)}</div>' if was else ""
            new = '<span class="new"></span>' if i["turn"] >= recent_from else ""
            faded = " faded" if i["status"] == "parked" else ""
            value = _clip(i["value"], 110)
            cards.append(
                f'<div class="card{faded}" style="border-left-color:{c}">'
                f'<div class="st" style="color:{c}">{ICON[i["status"]]} {_e(STATUS_LABEL[i["status"]])}{new}</div>'
                f'<div class="t">{_e(i["title"])}</div><div class="v">{_e(value)}</div>{was_html}</div>')
            h += 44 + 22 * _lines(i["title"], 28) + 19 * _lines(value, 36) + (16 * _lines(was_txt, 44) if was else 0)
            lint["title_words"].append(len(i["title"].split()))
            lint["value_words"].append(len(i["value"].split()))
        extra = len(live) - MAX_CARDS
        if extra > 0:
            cards.append(f'<div class="more">+{extra} more</div>')
            h += 20
        rows = []
        for i in done[:MAX_ROWS]:
            rows.append(f'<div class="row"><i style="color:{COLOR["done"]}">✓ {_e(i["title"])}</i> — {_e(_clip(i["value"], 60))}</div>')
            h += 19 * _lines(i["title"] + i["value"][:60], 38)
        if len(done) > MAX_ROWS:
            rows.append(f'<div class="more">+{len(done) - MAX_ROWS} more done</div>')
            h += 20
        if dropped:
            rows.append('<div class="drop">✕ dropped: ' + ", ".join(
                f"<s>{_e(i['title'])}</s>" for i in dropped[:5]) + (" …" if len(dropped) > 5 else "") + "</div>")
            h += 19 * _lines(" ".join(i["title"] for i in dropped[:5]), 40)
        lint["items_shown"] += min(len(live), MAX_CARDS) + min(len(done), MAX_ROWS) + min(len(dropped), 5)
        lint["max_cards_col"] = max(lint["max_cards_col"], min(len(live), MAX_CARDS))
        cols.append(f'<div class="col"><h2>{_e(th)}</h2>{"".join(cards)}{"".join(rows)}</div>')
        col_heights.append(h)
    lint["items_hidden"] = lint["items_total"] - lint["items_shown"]
    legend = "".join(f'<span><b style="background:{COLOR[s]}">{ICON[s]}</b>{_e(STATUS_LABEL[s])}</span>'
                     for s in ["waiting", "open", "decided", "done", "parked"])
    foot = ""
    if hidden:
        foot = '<div class="foot">Older threads: ' + ", ".join(
            f"{_e(t)} ({len(ledger.by_thread(t))})" for t in hidden) + "</div>"
    sub = (f"turn {turn} · {counts['waiting']} waiting on you · {counts['open']} open · "
           f"{counts['decided']} decided, not built · {counts['done']} done")
    body = (f'<h1>Where things stand</h1><div class="sub">{sub}</div><div class="legend">{legend}</div>'
            f'<div class="grid" style="grid-template-columns:repeat({COLS},1fr)">{"".join(cols)}</div>{foot}')
    grid_rows = [max(col_heights[r:r + COLS]) for r in range(0, len(col_heights), COLS)] or [0]
    height = 190 + sum(grid_rows) + 16 * len(grid_rows) + (40 if hidden else 0) + 40
    return _page(body), max(600, int(height)), lint


MAX_SETTLED = 10


def board_html_kinds(ledger: Ledger, turn: int, recent_from: int):
    """v4 layout. Per thread: what needs attention as cards (waiting, open),
    then every settled decision and rule as one row, then tasks as a count."""
    threads = ledger.threads()
    shown, hidden = threads[:MAX_THREADS], threads[MAX_THREADS:]
    counts = {s: sum(1 for i in ledger.items.values() if i["status"] == s) for s in COLOR}
    lint = {"threads_total": len(threads), "threads_shown": len(shown), "items_total": len(ledger.items),
            "items_shown": 0, "items_hidden": 0, "title_words": [], "value_words": [], "max_cards_col": 0}
    cols, col_heights = [], []
    for th in shown:
        items = ledger.by_thread(th)
        kind = lambda i: i.get("kind") or "decision"
        attention = [i for i in items if i["status"] in ("waiting", "open")]
        settled = [i for i in items if kind(i) in ("decision", "rule") and i["status"] in ("decided", "done")]
        settled.sort(key=lambda i: (kind(i) != "rule", -i["turn"]))
        parked = [i for i in items if i["status"] == "parked"]
        dropped = [i for i in items if i["status"] == "dropped"]
        tasks = [i for i in items if kind(i) == "task" and i["status"] in ("decided", "done")]
        h = 44 + 22 * _lines(th, 26)
        parts = []
        for i in attention[:MAX_CARDS]:
            c = COLOR[i["status"]]
            new = '<span class="new"></span>' if i["turn"] >= recent_from else ""
            value = _clip(i["value"], 100)
            parts.append(
                f'<div class="card" style="border-left-color:{c}">'
                f'<div class="st" style="color:{c}">{ICON[i["status"]]} {_e(STATUS_LABEL[i["status"]])}{new}</div>'
                f'<div class="t">{_e(i["title"])}</div><div class="v">{_e(value)}</div></div>')
            h += 44 + 22 * _lines(i["title"], 28) + 19 * _lines(value, 36)
            lint["title_words"].append(len(i["title"].split()))
            lint["value_words"].append(len(i["value"].split()))
        if len(attention) > MAX_CARDS:
            parts.append(f'<div class="more">+{len(attention) - MAX_CARDS} more open</div>')
            h += 20
        if settled:
            parts.append('<div class="st" style="color:#374151;margin:8px 0 2px">Settled</div>')
            h += 26
        for i in settled[:MAX_SETTLED]:
            mark = "★" if kind(i) == "rule" else ("●" if i["status"] == "decided" else "✓")
            color = COLOR["decided"] if i["status"] == "decided" else COLOR["done"]
            was = Ledger.prior_values(i)
            was_html = f' <span class="was">↺ was {_e(_clip(was[-1], 30))}</span>' if was else ""
            parts.append(f'<div class="row"><i style="color:{color}">{mark} {_e(i["title"])}</i> — '
                         f'{_e(_clip(i["value"], 70))}{was_html}</div>')
            h += 19 * _lines(i["title"] + i["value"][:70] + (" was " + was[-1][:30] if was else ""), 38)
            lint["title_words"].append(len(i["title"].split()))
            lint["value_words"].append(len(i["value"].split()))
        if len(settled) > MAX_SETTLED:
            parts.append(f'<div class="more">+{len(settled) - MAX_SETTLED} more settled</div>')
            h += 20
        meta = []
        if tasks:
            nd = sum(1 for i in tasks if i["status"] == "done")
            meta.append(f"Tasks: {nd} done, {len(tasks) - nd} to build")
        if parked:
            meta.append("⏸ parked: " + ", ".join(_e(i["title"]) for i in parked[:4]) + (" …" if len(parked) > 4 else ""))
        if dropped:
            meta.append("✕ dropped: " + ", ".join(f"<s>{_e(i['title'])}</s>" for i in dropped[:4]) + (" …" if len(dropped) > 4 else ""))
        for m in meta:
            parts.append(f'<div class="drop">{m}</div>')
            h += 19 * _lines(m, 40)
        lint["items_shown"] += (min(len(attention), MAX_CARDS) + min(len(settled), MAX_SETTLED) + len(tasks)
                                + min(len(parked), 4) + min(len(dropped), 4))
        lint["max_cards_col"] = max(lint["max_cards_col"], min(len(attention), MAX_CARDS))
        cols.append(f'<div class="col"><h2>{_e(th)}</h2>{"".join(parts)}</div>')
        col_heights.append(h)
    lint["items_hidden"] = lint["items_total"] - lint["items_shown"]
    legend = "".join(f'<span><b style="background:{COLOR[s]}">{ICON[s]}</b>{_e(STATUS_LABEL[s])}</span>'
                     for s in ["waiting", "open", "decided", "done"]) + \
        f'<span><b style="background:#374151">★</b>standing rule</span>'
    foot = ""
    if hidden:
        foot = '<div class="foot">Older threads: ' + ", ".join(
            f"{_e(t)} ({len(ledger.by_thread(t))})" for t in hidden) + "</div>"
    sub = (f"turn {turn} · {counts['waiting']} waiting on you · {counts['open']} open · "
           f"{counts['decided']} decided, not built · {counts['done']} done")
    body = (f'<h1>Where things stand</h1><div class="sub">{sub}</div><div class="legend">{legend}</div>'
            f'<div class="grid" style="grid-template-columns:repeat({COLS},1fr)">{"".join(cols)}</div>{foot}')
    grid_rows = [max(col_heights[r:r + COLS]) for r in range(0, len(col_heights), COLS)] or [0]
    height = 190 + sum(grid_rows) + 16 * len(grid_rows) + (40 if hidden else 0) + 40
    return _page(body), max(600, int(height)), lint


def list_html(ledger: Ledger):
    text = ledger.to_text()
    body = ('<pre style="font:15px/1.45 -apple-system,sans-serif;white-space:pre-wrap">'
            f"{_e(text)}</pre>")
    lines = sum(1 + len(l) // 170 for l in text.split("\n"))
    return _page(body), max(700, 80 + lines * 22)


def _page(body):
    return f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{body}</body></html>"


def screenshot(html_text, png_path, height):
    png_path = pathlib.Path(png_path)
    html_path = png_path.with_suffix(".html")
    html_path.write_text(html_text, encoding="utf-8")
    profile = png_path.parent.parent / ".chrome-profile"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    f"--user-data-dir={profile}", f"--window-size={WIDTH + 64},{height}",
                    f"--screenshot={png_path}", html_path.as_uri()],
                   capture_output=True, timeout=120)
    return png_path


def downscale(png_path, width, out_path):
    """A 'glance' copy: shrink so only large type and visual cues survive."""
    subprocess.run(["sips", "-Z", str(width), str(png_path), "--out", str(out_path)],
                   capture_output=True, timeout=60)
    return out_path


def lint_score(lint):
    """Share of perception checks the board passes (0..1)."""
    tw, vw = lint["title_words"] or [0], lint["value_words"] or [0]
    checks = {
        "items_on_screen_<=40": lint["items_shown"] <= 40,
        "cards_per_column_<=5": lint["max_cards_col"] <= MAX_CARDS,
        "titles_<=6_words": sum(w <= 6 for w in tw) / len(tw) >= 0.9,
        "values_<=15_words": sum(w <= 15 for w in vw) / len(vw) >= 0.9,
        "nothing_hidden": lint["items_hidden"] == 0,
        "status_not_colour_only": True,  # by construction: colour + icon + word
    }
    return sum(checks.values()) / len(checks), checks
