"""A 10-second glance test for humans: the model-based glance score is only a
proxy, so this page lets a founder take the same probes against the boards.

Each round shows a board for 10 seconds, hides it, asks the probe question,
then reveals the gold answer for self-grading. Results stay in the page.
"""
import json
import pathlib
import random

SECONDS = 10


def build(out="out/v2", probes_path="data/probes.json", n=10, seed=7):
    out = pathlib.Path(out)
    probes = {p["id"]: p for p in json.load(open(probes_path))["probes"]}
    boards = json.loads((out / "results.json").read_text())["boards"]
    random.Random(seed).shuffle(boards)
    rounds = []
    for b in boards[:n]:
        p = probes[b["probe"]]
        png = pathlib.Path(b["png"])
        rounds.append({"img": str(png.relative_to(out.resolve()) if png.is_absolute() else png.relative_to(out)),
                       "q": p["q"], "gold": p["gold"], "id": p["id"]})
    page = TEMPLATE.replace("__ROUNDS__", json.dumps(rounds)).replace("__SECONDS__", str(SECONDS))
    path = out / "glance-test.html"
    path.write_text(page, encoding="utf-8")
    return path


TEMPLATE = """<!doctype html><html><head><meta charset="utf-8"><title>Glance test</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:16px/1.5 -apple-system,sans-serif;max-width:1200px;margin:20px auto;padding:0 16px;color:#1F2937;background:#FAF9F6}
img{width:100%;border:1px solid #ddd;border-radius:8px}
button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #9CA3AF;background:#fff;cursor:pointer;margin-right:8px}
.q{font-size:20px;font-weight:600;margin:16px 0}
textarea{width:100%;font:inherit;padding:8px;border-radius:8px;border:1px solid #9CA3AF}
.gold{background:#ECFDF5;border:1px solid #A7F3D0;padding:10px;border-radius:8px;margin:10px 0}
.timer{font-size:28px;font-weight:600;color:#C2410C}
</style></head><body>
<h1>Glance test</h1>
<p>Each board shows for __SECONDS__ seconds. Then answer the question from memory, reveal the gold, and grade yourself.</p>
<div id="app"></div>
<script>
const R = __ROUNDS__; let i = 0, score = 0, log = [];
const app = document.getElementById('app');
function round(){
  if(i >= R.length){ app.innerHTML = `<h2>Done: ${score} / ${R.length}</h2><pre>${JSON.stringify(log,null,1)}</pre>`; return; }
  const r = R[i]; let left = __SECONDS__;
  app.innerHTML = `<p>Round ${i+1} of ${R.length} · <b>Question coming:</b> ${r.q}</p><div class="timer" id="t">${left}</div><img src="${r.img}">`;
  const tick = setInterval(()=>{ left--; const t=document.getElementById('t'); if(t) t.textContent=left;
    if(left<=0){ clearInterval(tick); ask(r); } }, 1000);
}
function ask(r){
  app.innerHTML = `<div class="q">${r.q}</div><textarea id="a" rows="3" placeholder="Your answer"></textarea><br><br><button id="rev">Reveal gold</button>`;
  document.getElementById('rev').onclick = ()=>{
    const a = document.getElementById('a').value;
    if(!a.trim()){ alert('Write an answer first'); return; }
    app.innerHTML += `<div class="gold"><b>Gold:</b> ${r.gold}</div><button id="y">Right</button><button id="h">Half</button><button id="n">Wrong</button>`;
    const grade = s => { score += s; log.push({id:r.id, answer:a, score:s}); i++; round(); };
    document.getElementById('y').onclick=()=>grade(1);
    document.getElementById('h').onclick=()=>grade(0.5);
    document.getElementById('n').onclick=()=>grade(0);
  };
}
round();
</script></body></html>"""
