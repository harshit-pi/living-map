"""Build the ledger from a transcript, window by window, saving a snapshot
after every window so any turn can be scored against 'what the ledger knew
then'."""
import json
import pathlib

from . import llm
import copy

from .ledger import Ledger, OPS_SCHEMA
from .transcripts import render_turns

SYSTEM_V1 = """You keep a DECISION LEDGER for a long working session between a user and an AI agent (coding, design, product work). The ledger is how the user and the AI recover what is settled after the chat history is gone, so it must hold the specific answer, not a vague topic.

Record only what someone would need later:
- decisions and choices: tool, model, architecture, datastore, scope, numbers, names, time windows
- standing rules and preferences the user states ("always merge yourself", "use my open Chrome", "devo is free to test")
- open questions that block work
- deferrals ("later", "not in v1") -> parked
- work the AI reports as built, merged or deployed -> done; decided but not yet built -> decided
- options rejected or removed -> dropped
- things waiting on the user (approve, run, provide) -> waiting
Never record chit-chat, debugging steps, transient errors, explanations, or file-level edits.

The user decides. An AI proposal stays "open" until the user accepts it.

Each op:
- id: a short kebab-case slug naming the TOPIC, never the value ("extraction-model", not "use-qwen"). If the topic is already in the ledger, emit op "update" with the SAME id: that is how a change of mind is tracked.
- thread: a 2-4 word workstream name. Reuse an existing thread name exactly when it fits.
- title: the topic in 2-6 words ("Extraction model").
- value: the current answer, specific, at most 15 words, with names and numbers ("Qwen3 locally; Claude too costly").
- status: open | decided | done | parked | dropped | waiting
- turn: the turn index where it happened.

Be economical: usually 0-6 ops per batch. Update existing items rather than adding near-duplicates."""

# v2: fewer, stabler threads and terse values (v1 boards fragmented into 13-17
# threads and values carried status narration like "awaiting your call").
SYSTEM_V2 = SYSTEM_V1.replace(
    "- thread: a 2-4 word workstream name. Reuse an existing thread name exactly when it fits.",
    "- thread: one of AT MOST 6 workstreams for the whole session, 2-3 words each (e.g. \"Ingestion pipeline\", "
    "\"Production infra\", \"Product UX\", \"Working rules\"). Always map to an existing thread if it is close; "
    "create a new one only for a genuinely new workstream. Standing rules and preferences go in \"Working rules\".",
).replace(
    "- value: the current answer, specific, at most 15 words, with names and numbers (\"Qwen3 locally; Claude too costly\").",
    "- value: ONLY the current answer, at most 12 words, with names and numbers (\"Qwen3, run locally\"). "
    "No status narration (\"awaiting your call\", \"in progress\"): that is what status is for.",
)
# v3: v1 misses showed the ledger copying the AI's drift (a user's "calendar
# later" overwritten by the AI's roadmap) and missing standing rules the user
# restated in frustration ("why are you waiting on me to merge PRs").
SYSTEM_V3 = SYSTEM_V2.replace(
    "The user decides. An AI proposal stays \"open\" until the user accepts it.",
    "The user decides. An AI proposal stays \"open\" until the user accepts it. "
    "Only the USER's words can change an item the user decided, parked or dropped: if the AI's plan or summary "
    "contradicts a user decision, keep the user's value (the AI drifted). "
    "A user correcting or complaining (\"I thought we decided…\", \"why are you waiting on me to…\", \"I meant…\") "
    "restates a decision or a standing rule: record it as decided, in \"Working rules\" if it is a rule.",
)
# v4: boards hid ~60 items per chat because tasks ("sidebar built") crowded out
# the choices people actually lose ("storage: SQLite"). Tag each item's kind so
# the board can list every decision and rule and shrink tasks to a count.
SYSTEM_V4 = SYSTEM_V3.replace(
    "- turn: the turn index where it happened.",
    "- turn: the turn index where it happened.\n"
    "- kind: decision (a choice between options: tool, model, scope, number, approach) | "
    "rule (a standing instruction or preference that applies going forward) | "
    "task (a piece of work to build, fix or ship) | question (an open question). "
    "A built feature is a task; the choice of HOW it is built is a decision.",
)
PROMPTS = {"v1": SYSTEM_V1, "v2": SYSTEM_V2, "v3": SYSTEM_V3, "v4": SYSTEM_V4}

# v1-v3 ran before items had a kind; keep their exact schema so cached windows replay
_NO_KIND = copy.deepcopy(OPS_SCHEMA)
del _NO_KIND["properties"]["ops"]["items"]["properties"]["kind"]
SCHEMAS = {"v1": _NO_KIND, "v2": _NO_KIND, "v3": _NO_KIND, "v4": OPS_SCHEMA}
SYSTEM = SYSTEM_V1


def build(name, turns, upto, outdir, window=6, model="haiku", system=None, schema=None):
    """Process turns[0:upto]; return {boundary_turn: Ledger} and spend stats."""
    outdir = pathlib.Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    ledger, snaps = Ledger(), {0: Ledger()}
    spend = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "turns": upto}
    for start in range(0, upto, window):
        chunk = turns[start:min(start + window, upto)]
        prompt = (f"CURRENT LEDGER (id | thread | title | value | status | last turn):\n{ledger.to_prompt()}\n\n"
                  f"NEW TURNS:\n{render_turns(chunk)}\n\nReturn ops for the new turns only.")
        res = llm.call(prompt, system or SYSTEM, model=model, schema=schema or OPS_SCHEMA, tag=f"extract:{name}:{start}")
        ledger.apply(res["structured"].get("ops", []))
        boundary = chunk[-1].idx + 1
        snaps[boundary] = ledger.copy()
        for k in ("input_tokens", "output_tokens", "cost_usd"):
            spend[k] += res[k]
        spend["calls"] += 1
        (outdir / f"ledger_t{boundary:03d}.json").write_text(ledger.to_json())
    (outdir / "spend.json").write_text(json.dumps(spend, indent=1))
    return snaps, spend


def snapshot_before(snaps, turn):
    """The newest snapshot built only from turns before `turn`."""
    return snaps[max(k for k in snaps if k <= turn)]
