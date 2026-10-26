# Security

Living Map runs on your own machine:

- The server listens on `127.0.0.1` only, so other machines cannot reach it.
- Every API call needs a local token kept in `~/.living-map/token`, readable only by you, and a page from another site is refused even with it.
- The map is kept in `~/.living-map/ledger.db` (readable only by you), since it quotes your chats.
- The model is reached through your own Claude Code (`claude -p`), with your MCP servers and settings turned off for each call. Filing a chat's turns runs with no tools at all. A side chat gets only read-only tools (Read, Glob, Grep) in your project folder, with no web: it cannot edit files or run commands, and what it proposes for the map changes nothing until you apply it.

## Reporting a vulnerability

Please report security problems privately through GitHub's "Report a vulnerability" button on this repository's Security tab, not in a public issue. Include the steps to reproduce and what an attacker could do.
