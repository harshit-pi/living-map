---
name: living-map
description: Opens a Living Map of this conversation beside the chat, starting the local Living Map server first if it is not running. The map is one conversation seen in the view it needs (a decision board in Explore, a learning path in Learn, a system design in Design, picked from what the conversation is doing, switchable any time), with a rail beside every view that follows the conversation as it goes (what waits on the user, what Claude still has to do, what was decided) and side chats that know everything said here. Use when the user says "living map", "map this", "open the map", "track this", "what's pending", "start a side chat", "explore this visually", "learn this step by step", "/living-map", or asks what is on their map, what is still to do, or to update it.
argument-hint: "[explore|learn|design] [question or topic]"
---

<!-- living-map-skill: installed by `npm run skill` from {{APP_DIR}}; the server rewrites this file when it updates -->

# Living Map

Living Map is a local web app on http://localhost:{{PORT}} that draws **this conversation** as a map the user works by clicking. One conversation, several views: Explore (a decision board), Learn (a path of steps) and Design (a system design), picked from what the conversation is doing (`/living-map learn` and the like switch it; the map has no switcher of its own). Beside every view, a rail follows this conversation as it goes: what waits on the user, what Claude still has to do, what was decided, and the side chats the user starts from any of it. Moves on a view and side chats resume this conversation (forked, never written to), so they know everything said here; what the user does on the map comes back to you (see 4). You start the server, link this conversation, open the map beside the chat, and read it back when asked.

App folder: `{{APP_DIR}}`

## 1. Make sure the server runs

```bash
PORT={{PORT}} node "{{APP_DIR}}/skill/start.ts"
```

It returns at once if the server already runs; otherwise it installs and builds what is missing and starts the server detached, so it keeps running after this conversation ends (the first start takes up to a minute). Run it in the foreground, not with `run_in_background`. If it fails, show the user what it printed. If `{{APP_DIR}}` is missing, clone it first: `git clone https://github.com/harshit-pi/living-map.git ~/living-map`, then run `~/living-map/app/skill/start.ts` the same way. It needs Node 23.6 or newer and the `claude` command.

## 2. Link this conversation

- **View**: the first argument if it is `explore`, `learn` or `design`; otherwise leave it out (send `""`): the map reads the conversation first and opens the view it needs. Explore is for "lay out my options"; Learn is for "teach me" / "help me understand"; Design is for practising a system design.
- **Question**: the rest of the arguments if any; otherwise leave it out (send `""`): the map works it out from the conversation. Do this even in a brand-new conversation: never ask the user what to map first. The map starts following this conversation and fills in as you talk.
- **cwd**: the folder this conversation started in (your primary working directory), not a subfolder you moved into.

Send it, building the JSON with a tool that escapes it (here Python):

```bash
python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "cwd": sys.argv[2], "purpose": sys.argv[3], "question": sys.argv[4]}))' \
  "${CLAUDE_SESSION_ID}" "$PWD" "" "" \
  | curl -s -X POST localhost:{{PORT}}/api/link -H 'content-type: application/json' -H "X-LM-Token: $(cat ~/.living-map/token)" -d @-
```

The answer is `{"mapId", "title", "purpose", "created", "conversation", "url"}` or `{"error"}`. `url` is a one-time sign-in link to the page (valid for 60 seconds): open `http://localhost:{{PORT}}` followed by it.

- A conversation that already has a map opens its latest map again (the question is ignored), in every open tab. `"created": true` means a new map is drawing its first move now.
- A topic in another mode ("/living-map learn how CRDTs work" while the map is Explore) starts a map of its own. A mode with no topic ("/living-map learn") switches the open map instead: send `purpose` and leave `question` out (Explore and Learn share one map). If the answer asks for `question` (there is no map yet), send again with one.
- Add `"new": true` for a second map of the same conversation.
- If the session id is not filled in above, leave it as is: the server then links the newest conversation in `cwd`, which is this one.

## 3. Open it beside the chat

Open `http://localhost:{{PORT}}<url>` with the `url` from step 2: it signs the page in and shows the map. The page stays signed in, live, in that browser; another browser needs its own link, so link again (step 2) for it. The bare address without the link shows only how to open it.

- If you have a built-in browser pane (tools named `mcp__Claude_Browser__*` or `mcp__remote-devices__Claude_Browser__*`), read its skill and open the URL there, so the map sits next to this chat.
- Otherwise give the user the link to open. Run `open` (macOS) or `xdg-open` (Linux) on it only if they ask you to.

Then reply in one or two lines: the link, and what the map is drawing. Do not describe the map in the chat; it is on the canvas.

## 4. Listen to the map

Only when the answer in step 2 has `"listen": true`; otherwise skip this step. The map talks back: the user can write to you from it ("Tell Claude Code"), answer on a view, or pick an option, and expects you to act without having to type here. Start the listener in the background (with `run_in_background`, never in the foreground), unless one is already running in this conversation:

```bash
node "{{APP_DIR}}/skill/wait.ts" {{PORT}} "${CLAUDE_SESSION_ID}"
```

It ends the moment the map has something for you, printing it after `FROM YOUR LIVING MAP:`, and its ending wakes you. Then:

- Read it as the user's own words, written on their map: act on what they ask as if they had typed it here. A one-word answer ("yes", "go with B") answers what the map asked them; the lines it comes with say what.
- Work that leaves this machine or cannot be undone (pushing, opening a PR, sending, deleting) you do when the message clearly asks for that exact thing; when it is unclear, ask here in one line.
- Start the listener again right away, the same way, so the next one reaches you too.
- If the server was not running or the session id is not filled in, it says so and ends; start the map (step 1) and try once more.

## 5. Working together

- The rail follows this conversation by itself: each time you or the user write here, it files the new turns a few seconds later (a quick, separate call that reads only those turns). You never need to tell it what happened.
- **What the user does on the map comes back to you.** A side chat's answer, a task ticked, an option picked on the rail, a choice made on a view: it waits for this conversation. With the living-map hook installed (`npm run skill -- --hook` in `{{APP_DIR}}`), it arrives with the user's next message as a `LIVING MAP:` note: take it into account, as a colleague's answer the user asked for. Without the hook, read it yourself when the user mentions the map or a side chat:

  ```bash
  python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1]}))' "${CLAUDE_SESSION_ID}" \
    | curl -s -X POST localhost:{{PORT}}/api/inbox -H 'content-type: application/json' -H "X-LM-Token: $(cat ~/.living-map/token)" -d @-
  ```

  Everything the map holds (where things stand, what is pending, what was decided, every side chat's answer) is also kept as a page at `~/.living-map/conversations/<this conversation's id>.md`, for you or a new conversation picking up the work.

- When the user refers to the map ("what does my map say", "what did I pick", "where did we land"), read it first, then answer:

  ```bash
  curl -s localhost:{{PORT}}/api/outline -H "X-LM-Token: $(cat ~/.living-map/token)"
  ```

  It ends with the conversation's other maps, if any; read one with `curl -s "localhost:{{PORT}}/api/outline?id=<id>" -H "X-LM-Token: $(cat ~/.living-map/token)"`.

- The rail is always current; a view is redrawn only when asked. To bring something from this chat onto the open view ("add this to the map", "we decided X, update the map"), send it as a message on the linked map; it runs as a move there while you keep talking here:

  ```bash
  python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "cwd": sys.argv[2], "message": sys.argv[3]}))' \
    "${CLAUDE_SESSION_ID}" "$PWD" "We went with option B; bring that in." \
    | curl -s -X POST localhost:{{PORT}}/api/link -H 'content-type: application/json' -H "X-LM-Token: $(cat ~/.living-map/token)" -d @-
  ```

- Moves on the map are paid model calls; a side chat reads this whole conversation. Do not start them unless the user asks for a map or an update.
- Never stop the server or delete maps unless the user asks. Maps are kept in `~/.living-map/maps/`, the server's log in `~/.living-map/server.log`.
