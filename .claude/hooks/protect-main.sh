#!/usr/bin/env bash
# PreToolUse/Bash guard: main is reached only through a pull request.
#
# Every push to main publishes a release that running copies offer as an
# update, so a commit or push that lands on main skips review and ships at
# once. This blocks the two ways that happens rather than trusting every
# session to remember: sessions are not all interactive, and the branch can
# change under a running one. Needs jq; without it the hook
# allows everything.
#
# Reads the hook payload on stdin, prints a PreToolUse permission decision.
cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
[ -n "$cmd" ] || exit 0
case "$cmd" in *git*) ;; *) exit 0 ;; esac

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# Which checkout does this command act on? One that cds into a worktree, or
# passes `git -C`, is not talking about the session's directory -- and every
# reproducible build in this repo happens in a throwaway worktree, so reading
# the session's branch would judge those against the wrong repo's state.
dir=$(printf '%s' "$cmd" | sed -n 's/.*git[[:space:]]\{1,\}-C[[:space:]]\{1,\}\([^[:space:];&|]*\).*/\1/p' | head -1)
[ -n "$dir" ] || dir=$(printf '%s' "$cmd" | sed -n 's/^[[:space:]]*cd[[:space:]]\{1,\}"\{0,1\}\([^"[:space:];&|]*\)"\{0,1\}.*/\1/p' | head -1)
[ -n "$dir" ] || dir=.
branch=$(git -C "$dir" branch --show-current 2>/dev/null)

# A commit while HEAD is on main. Checked at the moment of the commit, because
# the branch this session started on is not necessarily the branch it is on now.
if printf '%s' "$cmd" | grep -Eq '(^|[;&|]|&&)[[:space:]]*git[[:space:]]+([^;&|]*[[:space:]])?commit\b'; then
  if [ "$branch" = "main" ]; then
    deny "main is PR-only in this repo, and HEAD is on main right now. Branch first (git switch -c <branch>), then commit. If the work is already committed here, move it: git branch <branch> && git reset --hard origin/main."
  fi
fi

# A push that would land on main — named explicitly, or implied by pushing the
# current branch while standing on main.
if printf '%s' "$cmd" | grep -Eq '(^|[;&|]|&&)[[:space:]]*git[[:space:]]+([^;&|]*[[:space:]])?push\b'; then
  if printf '%s' "$cmd" | grep -Eq 'push[^;&|]*[[:space:]](main|[^;&|[:space:]]*:main|HEAD:main)([[:space:]]|$)'; then
    deny "main is PR-only in this repo. Push your branch instead and open a PR: git push -u origin <branch> && gh pr create."
  fi
  # Bare `git push` / `git push origin` on main resolves to main.
  if [ "$branch" = "main" ] && ! printf '%s' "$cmd" | grep -Eq 'push[^;&|]*[[:space:]][^-][^;&|[:space:]]*[[:space:]][^-][^;&|[:space:]]*'; then
    deny "main is PR-only in this repo and HEAD is on main, so this push targets main. Branch first, then push that branch and open a PR."
  fi
fi

exit 0
