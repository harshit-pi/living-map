"""The decision ledger: one store of typed items, rendered for the AI as text
and for the person as a board.

An item is a TOPIC ("Extraction model") with a current VALUE ("Qwen3 locally")
and a STATUS. Changing the value of a topic keeps the old value in history,
which is how reversals stay visible instead of silently overwritten.
"""
import copy
import json

STATUSES = ["waiting", "open", "decided", "done", "parked", "dropped"]
STATUS_LABEL = {
    "waiting": "waiting on you", "open": "open", "decided": "decided, not built",
    "done": "done", "parked": "parked", "dropped": "dropped",
}

OPS_SCHEMA = {
    "type": "object",
    "properties": {
        "ops": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "op": {"type": "string", "enum": ["add", "update"]},
                    "id": {"type": "string"},
                    "thread": {"type": "string"},
                    "title": {"type": "string"},
                    "value": {"type": "string"},
                    "status": {"type": "string", "enum": STATUSES},
                    "turn": {"type": "integer"},
                    "kind": {"type": "string", "enum": ["decision", "rule", "task", "question"]},
                },
                "required": ["op", "id", "status", "turn"],
            },
        }
    },
    "required": ["ops"],
}


class Ledger:
    def __init__(self, items=None):
        self.items = items or {}  # id -> item dict

    def copy(self):
        return Ledger(copy.deepcopy(self.items))

    def apply(self, ops):
        for op in ops or []:
            iid = (op.get("id") or "").strip().lower()
            if not iid:
                continue
            cur = self.items.get(iid)
            if cur is None:
                if not op.get("title") or not op.get("value"):
                    continue
                self.items[iid] = {
                    "id": iid, "thread": op.get("thread") or "General",
                    "title": op["title"], "value": op["value"], "status": op["status"],
                    "turn": op["turn"], "first_turn": op["turn"], "history": [],
                    "kind": op.get("kind"),
                }
                continue
            new_value = op.get("value") or cur["value"]
            if new_value != cur["value"] or op["status"] != cur["status"]:
                cur["history"].append({"value": cur["value"], "status": cur["status"], "turn": cur["turn"]})
                cur["value"], cur["status"], cur["turn"] = new_value, op["status"], op["turn"]
            if op.get("thread"):
                cur["thread"] = op["thread"]
            if op.get("title"):
                cur["title"] = op["title"]
            if op.get("kind"):
                cur["kind"] = op["kind"]

    # ---- views -------------------------------------------------------------

    def threads(self):
        """Threads ordered by most recent activity."""
        last = {}
        for it in self.items.values():
            last[it["thread"]] = max(last.get(it["thread"], -1), it["turn"])
        return sorted(last, key=lambda t: -last[t])

    def by_thread(self, thread):
        order = {s: i for i, s in enumerate(STATUSES)}
        its = [i for i in self.items.values() if i["thread"] == thread]
        return sorted(its, key=lambda i: (order[i["status"]], -i["turn"]))

    @staticmethod
    def prior_values(item):
        """Earlier values of this topic, oldest first, de-duplicated."""
        vals = []
        for h in item["history"]:
            if h["value"] != item["value"] and (not vals or vals[-1] != h["value"]):
                vals.append(h["value"])
        return vals

    def to_prompt(self):
        """Compact form fed back to the extractor."""
        if not self.items:
            return "(empty)"
        return "\n".join(f"{i['id']} | {i['thread']} | {i['title']} | {i['value']} | {i['status']} | t{i['turn']}"
                         for i in self.items.values())

    def to_text(self):
        """What the AI re-reads after a compaction or a fresh session."""
        if not self.items:
            return "DECISION LEDGER: (empty)"
        lines = ["DECISION LEDGER — what is settled in this work. The user's decisions win over anything older."]
        for th in self.threads():
            lines.append(f"\n## {th}")
            for i in self.by_thread(th):
                was = self.prior_values(i)
                was_txt = f" (was: {' → '.join(was)})" if was else ""
                lines.append(f"- [{STATUS_LABEL[i['status']]}] {i['title']}: {i['value']}{was_txt} [t{i['turn']}]")
        return "\n".join(lines)

    def to_json(self):
        return json.dumps(self.items, indent=1)

    @classmethod
    def from_json(cls, text):
        return cls(json.loads(text))
