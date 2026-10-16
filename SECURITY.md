# Security

Living Map runs on your own machine:

- The server listens on `127.0.0.1` only, so other machines cannot reach it.
- Your maps are plain JSON files in `~/.living-map/maps/`.
- The model is reached through your own Claude Code (`claude -p`), with your MCP servers and settings turned off for each call. It starts in `~/.living-map/workspace/` (or the folder you set with `LIVING_MAP_CWD`) and is given only read-only tools (Read, Glob, Grep) and web search: it cannot edit files or run commands.

## Reporting a vulnerability

Please report security problems privately through GitHub's "Report a vulnerability" button on this repository's Security tab, not in a public issue. Include the steps to reproduce and what an attacker could do.
