---
name: living-map
description: Opens a Living Map of this conversation beside the chat, starting the local Living Map server first if it is not running. The map is one live mind map of the conversation, kept up to date as it goes (what waits on the user, what is still open, what was decided, what changed in the code), with side chats on any box that know everything said here. Use when the user says "living map", "map this", "open the map", "track this", "what's pending", "start a side chat", "/living-map", or asks what is on their map, what is still to do, or what was decided.
---

<!-- living-map-skill: installed by `npm run skill` from {{APP_DIR}}; the server rewrites this file when it updates -->

# Living Map

Living Map is a local web app on http://localhost:{{PORT}} that draws **this conversation** as one live mind map the user works by clicking. It follows the conversation by itself: a few seconds after each turn it files what was new (questions waiting on the user, tasks, decisions, what changed in the code). Side chats on any box know everything said here. What the user does on the map comes back to you (see 4). You start the server, link this conversation, open the map beside the chat, and read it back when asked.

App folder: `{{APP_DIR}}`

## 1. Make sure the server runs

```bash
PORT={{PORT}} node "{{APP_DIR}}/skill/start.ts"
```

It returns at once if the server already runs; otherwise it installs and builds what is missing and starts the server detached, so it keeps running after this conversation ends (the first start takes up to a minute). Run it in the foreground, not with `run_in_background`. If it fails, show the user what it printed. If `{{APP_DIR}}` is missing, clone it first: `git clone https://github.com/harshit-pi/living-map.git ~/living-map`, then run `~/living-map/skill/start.ts` the same way. It needs Node 23.6 or newer and the `claude` command.

## 2. Link this conversation

Send this conversation's id and the folder it started in (your primary working directory, not a subfolder you moved into), building the JSON with a tool that escapes it (here Python). Never ask the user what to map first: the map follows this conversation and fills in as you talk.

```bash
python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1], "cwd": sys.argv[2]}))' \
  "${CLAUDE_SESSION_ID}" "$PWD" \
  | curl -s -X POST localhost:{{PORT}}/api/link -H 'content-type: application/json' -H "X-LM-Token: $(cat ~/.living-map/token)" -d @-
```

The answer is `{"title", "created", "conversation", "listen", "url"}` or `{"error"}`. `"created": true` means the map starts following this conversation now; otherwise it already was. `url` is a one-time sign-in link to this conversation's map (valid for 5 minutes): open `http://localhost:{{PORT}}` followed by it. If the session id is not filled in above, leave it as is: the server then links the newest conversation in `cwd`, which is this one.

## 3. Open it beside the chat

Open `http://localhost:{{PORT}}<url>` with the `url` from step 2: it signs the page in and shows the map. The page stays signed in, live, in that browser. The user puts the map in their own browser from the map itself (⋯ → Open in your browser), so you need not link again for that. In a browser never signed in, the bare address offers to sign that browser in with one click (Show my maps); signed in, it lists every mapped chat.

- If you have a built-in browser pane (tools named `mcp__Claude_Browser__*` or `mcp__remote-devices__Claude_Browser__*`), read its skill and open the URL there, so the map sits next to this chat. Then make sure the pane is visible, not hidden: if `tabs_context` says it is hidden, front it (in the Claude desktop app, load `mcp__ccd_view__show_pane` with ToolSearch if it is deferred and call it with `pane: "preview"`, every time, so the map is docked beside the chat).
- Otherwise give the user the link to open. Run `open` (macOS) or `xdg-open` (Linux) on it only if they ask you to.

Then reply in one or two lines: that the map is open and fills in as you talk. Do not paste the sign-in link when the map opened in a browser pane: it works once and expires after 5 minutes, so clicking it later opens another browser with a dead link. Give the link only when you could not open a browser yourself, and say it expires in 5 minutes; to reopen the map later, link again (step 2) for a fresh one. Do not describe the map in the chat; it is on the page.

## 4. Listen to the map

The map talks back: the user can answer a question on it, pick an option, or apply what a side chat found, and expects you to act without having to type here. Start the listener in the background (with `run_in_background`, never in the foreground), unless one is already running in this conversation:

```bash
node "{{APP_DIR}}/skill/wait.ts" {{PORT}} "${CLAUDE_SESSION_ID}"
```

It ends the moment the map has something for you, printing it after `FROM YOUR LIVING MAP:`, and its ending wakes you. Then:

- Read it as the user's own words, written on their map: act on what they ask as if they had typed it here. A one-word answer ("yes", "go with B") answers what the map asked them; the lines it comes with say what.
- Work that leaves this machine or cannot be undone (pushing, opening a PR, sending, deleting) you do when the message clearly asks for that exact thing; when it is unclear, ask here in one line.
- Start the listener again right away, the same way, so the next one reaches you too.
- If the server was not running or the session id is not filled in, it says so and ends; start the map (step 1) and try once more.

## 5. Working together

- The map follows this conversation by itself: each time you or the user write here, it files the new turns a few seconds later (a quick, separate call that reads only those turns). You never need to tell it what happened.
- **What the user does on the map comes back to you.** With the living-map hook installed (`npm run skill -- --hook` in `{{APP_DIR}}`), what the listener has not already brought arrives with the user's next message as a `LIVING MAP:` note: take it into account, as a colleague's answer the user asked for. Without the hook, read it yourself when the user mentions the map or a side chat:

  ```bash
  python3 -c 'import json,sys; print(json.dumps({"session": sys.argv[1]}))' "${CLAUDE_SESSION_ID}" \
    | curl -s -X POST localhost:{{PORT}}/api/inbox -H 'content-type: application/json' -H "X-LM-Token: $(cat ~/.living-map/token)" -d @-
  ```

- When the user refers to the map ("what does my map say", "what's still open", "what did we decide"), read it first, then answer:

  ```bash
  curl -s "localhost:{{PORT}}/api/outline?conv=${CLAUDE_SESSION_ID}" -H "X-LM-Token: $(cat ~/.living-map/token)"
  ```

- A side chat is a paid model call that reads this conversation; the user starts them from the map. Do not start the map for a conversation unless the user asks for it.
- Never stop the server or delete its data unless the user asks. The map is kept in `~/.living-map/ledger.db`, the server's log in `~/.living-map/server.log`.
