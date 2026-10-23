---
name: living-map
description: Opens a Living Map of this conversation beside the chat, starting the local Living Map server first if it is not running. By default a live Chat map that follows this conversation as it goes (its topics, what is still to do, what was decided, what is open) with side chats that know everything said here; or a decision board (Explore), a learning path (Learn) or a design exercise (Design). Use when the user says "living map", "map this", "open the map", "track this", "start a side chat", "explore this visually", "learn this step by step", "/living-map", or asks what is on their map, what is still to do, or to update it.
argument-hint: "[chat|explore|learn|design] [question or topic]"
---

<!-- living-map-skill: installed by `npm run skill` from {{APP_DIR}}; the server rewrites this file when it updates -->

# Living Map

Living Map is a local web app on http://localhost:{{PORT}} that draws **this conversation** as a map the user works by clicking. Its Chat map follows this conversation as it goes: each topic in turn, with its tasks, decisions and open questions, and the side chats the user starts from any of them. A side chat resumes this conversation (forked, never written to), so it knows everything said here; what it answers comes back to you (see 4). You start the server, link this conversation, open the map beside the chat, and read it back when asked.

App folder: `{{APP_DIR}}`

## 1. Make sure the server runs

```bash
PORT={{PORT}} node "{{APP_DIR}}/skill/start.ts"
```

It returns at once if the server already runs; otherwise it installs and builds what is missing and starts the server detached, so it keeps running after this conversation ends (the first start takes up to a minute). Run it in the foreground, not with `run_in_background`. If it fails, show the user what it printed. If `{{APP_DIR}}` is missing, clone it first: `git clone https://github.com/harshit-pi/living-map.git ~/living-map`, then run `~/living-map/app/skill/start.ts` the same way. It needs Node 23.6 or newer and the `claude` command.

## 2. Link this conversation

- **Mode**: the first argument if it is `chat`, `explore`, `learn` or `design`; otherwise `chat`, the live map of this conversation. Explore is for "lay out my options" on one decision; Learn is for "teach me" / "help me understand"; Design is for practising a system design.
- **Question**: for `chat`, leave it out (send `""`): the map is of the whole conversation and takes its title. For the other modes, the rest of the arguments if any; otherwise write one short question (at most 12 words: it becomes the map's title), in the user's own words, saying what this conversation is deciding, investigating or learning. The map reads the whole conversation, so leave details out. If the conversation is brand new and there are no arguments, ask the user in one short question what to map, then continue.
- **cwd**: the folder this conversation started in (your primary working directory), not a subfolder you moved into.

Send it, building the JSON with a tool that escapes it (here Python):

```bash
python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "cwd": sys.argv[2], "purpose": sys.argv[3], "question": sys.argv[4]}))' \
  "${CLAUDE_SESSION_ID}" "$PWD" "chat" "" \
  | curl -s -X POST localhost:{{PORT}}/api/link -H 'content-type: application/json' -d @-
```

The answer is `{"mapId", "title", "purpose", "created", "conversation"}` or `{"error"}`.

- A conversation that already has a map opens its latest map again (the question is ignored), in every open tab. `"created": true` means a new map is drawing its first move now.
- A topic in another mode ("/living-map learn how CRDTs work" while the map is Explore) starts a map of its own. A mode with no topic ("/living-map learn") switches the open map instead: send `purpose` and leave `question` out (Explore and Learn share one map). If the answer asks for `question` (there is no map yet), send again with one.
- Add `"new": true` for a second map of the same conversation.
- If the session id is not filled in above, leave it as is: the server then links the newest conversation in `cwd`, which is this one.

## 3. Open it beside the chat

The map is http://localhost:{{PORT}}/ . It is the same in every tab and every browser, live, so the user can move between this app and Chrome freely.

- If you have a built-in browser pane (tools named `mcp__Claude_Browser__*` or `mcp__remote-devices__Claude_Browser__*`), read its skill and open the URL there, so the map sits next to this chat.
- Otherwise give the user the link to open. Run `open` (macOS) or `xdg-open` (Linux) on it only if they ask you to.

Then reply in one or two lines: the link, and what the map is drawing. Do not describe the map in the chat; it is on the canvas.

## 4. Working together

- A Chat map follows this conversation by itself: each time you or the user write here, it files the new turns a few seconds later (a quick, separate call that reads only those turns). You never need to tell it what happened.
- **Side chats come back to you.** When the user asks a side chat on the map, or ticks a task there, it waits for this conversation. With the living-map hook installed (`npm run skill -- --hook` in `{{APP_DIR}}`), it arrives with the user's next message as a `LIVING MAP:` note: take it into account, as a colleague's answer the user asked for. Without the hook, read it yourself when the user mentions the map or a side chat:

  ```bash
  python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1]}))' "${CLAUDE_SESSION_ID}" \
    | curl -s -X POST localhost:{{PORT}}/api/inbox -H 'content-type: application/json' -d @-
  ```

  Everything the map holds (where things stand, what is pending, what was decided, every side chat's answer) is also kept as a page at `~/.living-map/conversations/<this conversation's id>.md`, for you or a new conversation picking up the work.

- When the user refers to the map ("what does my map say", "what did I pick", "where did we land"), read it first, then answer:

  ```bash
  curl -s localhost:{{PORT}}/api/outline
  ```

  It ends with the conversation's other maps, if any; read one with `curl -s "localhost:{{PORT}}/api/outline?id=<id>"`.

- To put something from this chat onto an Explore, Learn or Design map ("add this to the map", "we decided X, update the map"), send it as a message on the linked map; it runs as a move there while you keep talking here (a Chat map needs none: it follows):

  ```bash
  python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "cwd": sys.argv[2], "message": sys.argv[3]}))' \
    "${CLAUDE_SESSION_ID}" "$PWD" "We went with option B; bring that in." \
    | curl -s -X POST localhost:{{PORT}}/api/link -H 'content-type: application/json' -d @-
  ```

- Moves on the map are paid model calls; a side chat reads this whole conversation. Do not start them unless the user asks for a map or an update.
- Never stop the server or delete maps unless the user asks. Maps are kept in `~/.living-map/maps/`, the server's log in `~/.living-map/server.log`.
