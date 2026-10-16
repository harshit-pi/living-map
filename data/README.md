# data/

Probe sets are built from **your own** Claude Code transcripts, so they stay on your machine: everything in this folder except this README and `example_probes.json` is git-ignored.

- `example_probes.json` shows the format.
- `probes.json`: hand-written probes, each anchored where you lost the thread (`anchor` is a phrase from your message there, or `anchor_turn` a turn index).
- `new_chats.json` + `python3 -I run_probegen.py`: generates and verifies more probes from transcripts into `probes_v2.json`.
