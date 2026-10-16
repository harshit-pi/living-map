"""The shape of the thinking: a conversation as a small tree of the questions
the user worked through, each with its answer, drawn with one fixed grammar.

At most 7 top-level questions and 3 sub-questions under each, so a picture
stays readable at a glance however long the conversation was.
"""
import html
import json
import pathlib

from . import llm, render

TREE_SYS = """You turn a long working conversation into the SHAPE OF ITS THINKING: a small tree of the questions the user worked through, each with its current answer.

You get the conversation's decision ledger (topics, values, statuses, history). Build:
- root: what the conversation is about, at most 6 words.
- branches: at most 7 top-level questions, in the order they came up. Each is a real question the user had to settle ("Which datastore?", "Who merges PRs?"), not a task.
- children: at most 3 sub-questions under a branch, only where they matter.
Each node: q (a question, at most 5 words, ending in "?"), a (the answer, at most 5 words; "open" if unsettled), status:
- settled: decided and still holds
- changed: decided, then reversed or revised (say the current answer; mention the old one in "was", at most 4 words)
- open: still undecided
- dropped: an option or idea that was killed (keep only the important ones)
Merge many small decisions into the one question they serve. Leave out tasks, bugs and implementation detail. Fewer, bigger questions beat many small ones."""

TREE_SCHEMA = {"type": "object", "properties": {
    "root": {"type": "string"},
    "branches": {"type": "array", "items": {"type": "object", "properties": {
        "q": {"type": "string"}, "a": {"type": "string"}, "status": {"type": "string", "enum": ["settled", "changed", "open", "dropped"]},
        "was": {"type": "string"},
        "children": {"type": "array", "items": {"type": "object", "properties": {
            "q": {"type": "string"}, "a": {"type": "string"},
            "status": {"type": "string", "enum": ["settled", "changed", "open", "dropped"]}, "was": {"type": "string"}},
            "required": ["q", "a", "status"]}}},
        "required": ["q", "a", "status"]}}},
    "required": ["root", "branches"]}

# one visual grammar: colour + border style + a word, never colour alone
STYLE = {
    "settled": {"fill": "#E1F5EE", "stroke": "#0F6E56", "text": "#04342C", "sub": "#0F6E56", "dash": "", "w": 1},
    "changed": {"fill": "#EEEDFE", "stroke": "#534AB7", "text": "#26215C", "sub": "#534AB7", "dash": "", "w": 1},
    "open": {"fill": "#FAEEDA", "stroke": "#BA7517", "text": "#412402", "sub": "#854F0B", "dash": "", "w": 2.5},
    "dropped": {"fill": "#F1EFE8", "stroke": "#888780", "text": "#5F5E5A", "sub": "#888780", "dash": "5 4", "w": 1},
}


def build(ledger, chat):
    items = sorted(ledger.items.values(), key=lambda i: i["first_turn"])
    lines = [f"{i['thread']} | {i['title']} | {i['value']} | {i['status']}"
             + (f" | was: {' → '.join(h['value'] for h in i['history'][-2:])}" if i["history"] else "")
             for i in items]
    r = llm.call("DECISION LEDGER (thread | topic | value | status | history), in the order topics came up:\n" + "\n".join(lines),
                 TREE_SYS, model="sonnet", schema=TREE_SCHEMA, tag=f"tree:{chat}")
    tree = r["structured"]
    tree["branches"] = tree["branches"][:7]
    for b in tree["branches"]:
        b["children"] = (b.get("children") or [])[:3]
    return tree


def _e(s):
    return html.escape(str(s))


def _wrap(text, per, lines):
    words, out, cur = str(text).split(), [], ""
    for w in words:
        if len(w) > per:
            w = w[: per - 1] + "…"
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= per:
            cur += " " + w
        else:
            out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    if len(out) > lines:
        out = out[:lines]
        out[-1] = out[-1][: per - 1].rstrip() + "…"
    return out


def _label(node):
    if node["status"] == "dropped":
        return f"dropped: {node['a']}" if node["a"].lower() not in ("open", "dropped", "") else "dropped"
    if node["status"] == "open":
        return "open" if node["a"].lower() in ("open", "") else f"open: {node['a']}"
    if node["status"] == "changed" and node.get("was"):
        return f"{node['a']} (was {node['was']})"
    return node["a"]


def _box(x, y, w, node):
    """A node: question over answer, wrapped; returns (svg, height)."""
    st = STYLE[node["status"]]
    mark = {"settled": "", "changed": "↺ ", "open": "? ", "dropped": "✕ "}[node["status"]]
    q = _wrap(mark + node["q"], max(10, int(w / 8.6)), 2)
    a = _wrap(_label(node), max(10, int(w / 7.2)), 2)
    h = 16 + len(q) * 19 + len(a) * 17 + 10
    dash = f' stroke-dasharray="{st["dash"]}"' if st["dash"] else ""
    parts = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{st["fill"]}" stroke="{st["stroke"]}" stroke-width="{st["w"]}"{dash}/>']
    ty = y + 8
    for line in q:
        ty += 19
        parts.append(f'<text x="{x + w / 2}" y="{ty}" text-anchor="middle" font-size="15" font-weight="600" fill="{st["text"]}">{_e(line)}</text>')
    for line in a:
        ty += 17
        parts.append(f'<text x="{x + w / 2}" y="{ty}" text-anchor="middle" font-size="13" fill="{st["sub"]}">{_e(line)}</text>')
    return "".join(parts), h


def svg(tree):
    n = max(1, len(tree["branches"]))
    bw, gap, pad = 200, 18, 30
    width = max(760, pad * 2 + n * bw + (n - 1) * gap)
    root_w, root_h = 380, 58
    rx = (width - root_w) / 2
    out = [f'<rect x="{rx}" y="{pad}" width="{root_w}" height="{root_h}" rx="9" fill="#FFFFFF" stroke="#5F5E5A" stroke-width="1.2"/>',
           f'<text x="{width / 2}" y="{pad + 35}" text-anchor="middle" font-size="17" font-weight="700" fill="#2C2C2A">{_e(tree["root"])}</text>']
    total = n * bw + (n - 1) * gap
    x0 = (width - total) / 2
    bus = pad + root_h + 30
    by = bus + 30
    cx = [x0 + k * (bw + gap) + bw / 2 for k in range(n)]
    out.append(f'<path d="M{width / 2} {pad + root_h} L{width / 2} {bus}" stroke="#888780" stroke-width="1.2" fill="none"/>')
    out.append(f'<path d="M{cx[0]} {bus} L{cx[-1]} {bus}" stroke="#888780" stroke-width="1.2" fill="none"/>')
    max_y = by
    for k, b in enumerate(tree["branches"]):
        x = x0 + k * (bw + gap)
        out.append(f'<path d="M{cx[k]} {bus} L{cx[k]} {by}" stroke="#888780" stroke-width="1.2" fill="none"/>')
        box, h = _box(x, by, bw, b)
        out.append(box)
        y = by + h
        for ch in b["children"]:
            out.append(f'<path d="M{cx[k]} {y} L{cx[k]} {y + 20}" stroke="#B4B2A9" stroke-width="1.2" fill="none"/>')
            y += 20
            box, h = _box(x + 12, y, bw - 24, ch)
            out.append(box)
            y += h
        max_y = max(max_y, y)
    ly = max_y + 40
    legend = [("settled", "settled"), ("changed", "changed its mind"), ("open", "still open"), ("dropped", "dropped")]
    lx = pad
    for status, label in legend:
        st = STYLE[status]
        dash = f' stroke-dasharray="{st["dash"]}"' if st["dash"] else ""
        out.append(f'<rect x="{lx}" y="{ly - 12}" width="16" height="16" rx="4" fill="{st["fill"]}" stroke="{st["stroke"]}" stroke-width="{st["w"]}"{dash}/>'
                   f'<text x="{lx + 24}" y="{ly + 1}" font-size="13" fill="#444441">{label}</text>')
        lx += 40 + len(label) * 7.5
    height = ly + 24
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
            f'style="font-family:-apple-system,Helvetica Neue,sans-serif;background:#FAF9F6">{"".join(out)}</svg>'), width, height


def draw(tree, png_path):
    source, w, h = svg(tree)
    page = f"<!doctype html><html><body style='margin:0;background:#FAF9F6'>{source}</body></html>"
    return render.screenshot_raw(page, png_path, w, h)
