# living-map

Long AI chats lose track of what is settled: you forget, and Claude forgets at every compaction. living-map keeps a **decision ledger** of the conversation, puts it back into Claude's context after a compaction or `/clear`, and shows it to you as a **board** beside the chat.

This repo has two parts:

- `plugin/`: the Claude Code plugin you use day to day.
- the evaluation pipeline (`lm/`, `run_*.py`): scores the ledger against real transcripts before anything changes.

## The plugin

### Install

At the prompt of a Claude Code terminal session:

```
/plugin install living-map --marketplace harshit-pi/living-map
```

Answer `y` to add the marketplace, then pick the user scope so it runs in every session.

From a shell:

```bash
claude plugin install living-map --marketplace harshit-pi/living-map
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `harshit-pi/living-map`, then Add plugin. A plugin installed from a terminal at the user scope also runs in the desktop app's Code tab.

This repository is private: installing needs GitHub read access to it, and a git credential for github.com on that machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

### Update

After a new version is pushed:

```bash
claude plugin update living-map@living-map
```

then `/reload-plugins` in any open session.

| Command | What it does |
|---|---|
| `/map` | Opens the board; the first time in a session it maps the conversation so far, including what compaction removed |
| `/map-doctor` | Health check (capture, last extraction, lookup tool, what Claude gets, store size) plus a spot-check of 5 recent items against the turns they came from |
| `/map-ledger` | Prints the short summary Claude gets, and the full ledger |
| `/map-history` | Maps only the part of the conversation compaction removed |
| `/map-reset` | Forgets this folder's ledger |

On the board, pick an item under **Details** to see where it came from (your words, then Claude's) and how it changed; **Pin** keeps it in every summary Claude gets, **Drop** takes it off.

What runs on its own:

- **Capture.** Every 3 turns (or after 90 s idle) Haiku turns the new turns into ledger ops: decisions, standing rules, open questions, tasks, things waiting on you. Values that change keep their history, and each item keeps the turn it came from.
- **What Claude gets** is a short summary: pinned items, what waits on you, open questions, standing rules and the latest decisions. Everything else is one `map_lookup` call away: the plugin registers that tool, and Claude calls it before re-asking something you may have decided.
- **Before a compaction** pending turns are flushed (at most 30 s); **after it** the summary is appended to the compacted conversation.
- **A fresh session or `/clear`** in the same folder gets the summary with the first prompt.
- **The board** draws as SVG cards on the desktop app and as text in the terminal; a band above the prompt shows what is waiting on you, and the status line shows `map: N waiting · N open · N settled`.

The ledger is stored per folder in the plugin's store (`$.store`). Known limit: a batch Haiku cannot answer in JSON stays queued and is retried on the next trigger; the board shows the error.

## The evaluation pipeline

### What gets scored

| Score | Question it answers | How |
|---|---|---|
| Capture | Does the ledger hold what is settled? | 26 gold probes, asked at the turn where the user actually lost the thread; answered from the ledger; graded by a judge model |
| Retention | Is it better than what Claude kept? | Same probes answered from the real compaction summary + turns since |
| Tokens | Does it save context? | Context size per condition; extraction prompt and output tokens per turn; cost per 100 turns |
| Glance | Can it be read off the picture? | Probes answered from a screenshot only: board vs the same ledger as a plain list, at full size and shrunk to 900px |
| Lint | Does the board follow the perception rules? | ≤40 items on screen, ≤5 live cards per thread, short labels, nothing hidden, status never colour-only |

### Run

```bash
python3 -I run_extract.py v2     # build ledgers -> out/v2/<chat>/ledger_tNNN.json
python3 -I run_score.py v2       # score -> out/v2/scorecard.md and .html
```

Model calls go through headless `claude -p` (your Claude Code login), cached in
`cache/` so re-runs never re-spend tokens; `cache/usage.jsonl` logs every real
call. MCP servers and settings are disabled per call, which cuts overhead from
~287k tokens to under 1k.

### Layout

- `lm/transcripts.py` — JSONL transcript → human turns + compaction summaries
- `lm/ledger.py` — the ledger: items, history of changed values, text view
- `lm/extract.py` — windowed extraction (6 turns per call), versioned prompts
- `lm/render.py` — board and list HTML, Chrome screenshots, perception lint
- `lm/score.py` — probes × contexts, glance test, judge
- `lm/report.py` — scorecard
- `data/` — your probe sets, built from your own transcripts and git-ignored; see `data/README.md`

Transcripts and outputs stay local; `out/` and `cache/` are not committed.

### Results so far (2026-10-15)

| | v1 | v2 | v3 | v4 |
|---|---|---|---|---|
| Capture: what Claude had after compaction | 0.58 | 0.58 | 0.58 | 0.58 |
| Capture: ledger alone | 0.83 | 0.75 | 0.83 | 0.81 |
| Capture: ledger + last 6 turns | 0.75 | 0.77 | 0.77 | 0.75 |
| Overview at glance size: board vs list | 0.64 / 0.05 | 0.67 / 0.29 | 0.68 / 0.30 | 0.64 / 0.25 |
| Threads per chat | 12.8 | 5.5 | 5.7 | 5.5 |
| Items hidden on the board | 60 | 62 | 64 | 23 |

- v2: at most 6 threads, terse values. v3: only the user's words change a user decision; complaints restate rules. v4: items carry a kind (decision, rule, task, question); the board lists every decision and rule and counts tasks.
- Context: ~4.6k-token ledger vs ~20k tokens Claude carried. Extraction ~900 prompt + ~450 output tokens per turn on Haiku, ~6¢ per 100 turns.
- Two gold answers were wrong and fixed against the transcripts (`gold_fixed` in `data/probes.json`).
- 26 probes: one probe moves a score by 0.04, so v2–v4 differences are noise.
- Human check: open `out/v4/glance-test.html` (10 seconds per board).

### 122-probe run (2026-10-15)

26 lost-thread probes plus 96 generated ones (8 chats, 12 each, all asked after a compaction; every gold verified against the transcript up to the anchor, every quote found verbatim). Judge: Haiku. Full table: `out/stats_p2.md` (`python3 -I run_stats.py p2`).

| | v1 | v2 | v3 | v4 |
|---|---|---|---|---|
| Ledger alone | 0.79 | 0.75 | 0.76 | 0.72 |
| What Claude had | 0.50 | 0.57 | 0.55 | 0.55 |
| Ledger − Claude (paired) | +0.29 | +0.18 | +0.21 | +0.17 |
| Board − list, overview at glance size | +0.53 | +0.45 | +0.49 | +0.48 |

- The ledger beats what Claude kept in every version; every interval excludes 0.
- Prompt versions: only v4 − v1 (−0.07) clears its interval, and that is near the scorer's own noise (~0.07). Smallest detectable gap with 122 probes: ±0.08–0.10.
- The board beats the list for overview at glance size by about +0.5; for detail questions they tie.
