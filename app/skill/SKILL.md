---
name: living-map
description: Opens a Living Map of this conversation beside the chat (a decision board in Explore, a learning path in Learn, a design exercise in Design) that already knows everything said here, starting the local Living Map server first if it is not running. Use when the user says "living map", "map this", "open the map", "put this on a board", "explore this visually", "learn this step by step", "/living-map", or asks what is on their map or to update it.
argument-hint: "[explore|learn|design] [question or topic]"
---

<!-- living-map-skill: installed by `npm run skill` from {{APP_DIR}}; the server rewrites this file when it updates -->

# Living Map

Living Map is a local web app on http://localhost:{{PORT}} that draws **this conversation** as a map the user works by clicking. Every move on the map resumes this conversation (forked, never written to), so it knows what was said here, and anything said here later reaches its next move. You start the server, link this conversation, open the map beside the chat, and read it back when asked.

App folder: `{{APP_DIR}}`

## 1. Make sure the server runs

```bash
PORT={{PORT}} node "{{APP_DIR}}/skill/start.ts"
```

It returns at once if the server already runs; otherwise it installs and builds what is missing and starts the server detached, so it keeps running after this conversation ends (the first start takes up to a minute). Run it in the foreground, not with `run_in_background`. If it fails, show the user what it printed. If `{{APP_DIR}}` is missing, clone it first: `git clone https://github.com/harshit-pi/living-map.git ~/living-map`, then run `~/living-map/app/skill/start.ts` the same way. It needs Node 23.6 or newer and the `claude` command.

## 2. Link this conversation

- **Mode**: the first argument if it is `explore`, `learn` or `design`; otherwise `explore`. Learn is for "teach me" / "help me understand"; Design is for practising a system design.
- **Question**: the rest of the arguments if any; otherwise write one short question (at most 12 words: it becomes the map's title), in the user's own words, saying what this conversation is deciding, investigating or learning. The map reads the whole conversation, so leave details out. If the conversation is brand new and there are no arguments, ask the user in one short question what to map, then continue.
- **cwd**: the folder this conversation started in (your primary working directory), not a subfolder you moved into.

Send it, building the JSON with a tool that escapes it (here Python):

```bash
python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "cwd": sys.argv[2], "purpose": sys.argv[3], "question": sys.argv[4]}))' \
  "${CLAUDE_SESSION_ID}" "$PWD" "explore" "How should we price the new plan?" \
  | curl -s -X POST localhost:{{PORT}}/api/link -H 'content-type: application/json' -d @-
```

The answer is `{"mapId", "title", "purpose", "created", "conversation"}` or `{"error"}`.

- A conversation that already has a map opens that map again (the question is ignored), in every open tab. `"created": true` means a new map is drawing its first move now.
- Add `"new": true` for a second map of the same conversation.
- If the session id is not filled in above, leave it as is: the server then links the newest conversation in `cwd`, which is this one.

## 3. Open it beside the chat

The map is http://localhost:{{PORT}}/ . It is the same in every tab and every browser, live, so the user can move between this app and Chrome freely.

- If you have a built-in browser pane (tools named `mcp__Claude_Browser__*` or `mcp__remote-devices__Claude_Browser__*`), read its skill and open the URL there, so the map sits next to this chat.
- Otherwise give the user the link to open. Run `open` (macOS) or `xdg-open` (Linux) on it only if they ask you to.

Then reply in one or two lines: the link, and what the map is drawing. Do not describe the map in the chat; it is on the canvas.

## 4. Working together

- When the user refers to the map ("what does my map say", "what did I pick", "where did we land"), read it first, then answer:

  ```bash
  curl -s localhost:{{PORT}}/api/outline
  ```

- To put something from this chat onto the map ("add this to the map", "we decided X, update the map"), send it as a message on the linked map; it runs as a move there while you keep talking here:

  ```bash
  python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "cwd": sys.argv[2], "message": sys.argv[3]}))' \
    "${CLAUDE_SESSION_ID}" "$PWD" "We went with option B; bring that in." \
    | curl -s -X POST localhost:{{PORT}}/api/link -H 'content-type: application/json' -d @-
  ```

- Moves on the map are paid model calls that read this whole conversation; do not start them unless the user asks for a map or an update.
- Never stop the server or delete maps unless the user asks. Maps are kept in `~/.living-map/maps/`, the server's log in `~/.living-map/server.log`.
