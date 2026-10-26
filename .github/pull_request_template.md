## What

<!-- One or two lines -->

## Why

Fixes <!-- #issue, or "No issue" -->

## How tested

<!-- `npm run check`, what you tried on the map of a chat. Screenshots or a recording for UI. -->

## Risk

- [ ] Changes the release or update path (CI release job, `update.ts`, the launcher, `npm start`)
- [ ] Changes what the model is sent or asked (prompts, context, effort), so cost or speed per move
- [ ] Changes how maps are stored in `~/.living-map` (needs a migration on load)
- [ ] Sends map content somewhere new, or adds a network call
- [ ] Adds or upgrades a dependency
