#!/usr/bin/env bash
# PreToolUse/Bash guard: main is reached only through a pull request. Every
# push to main ships as an update to running copies, so a commit or push that
# lands there skips review. Needs jq; without it the hook allows everything.
# Reads the hook payload on stdin, prints a PreToolUse permission decision.
cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
[ -n "$cmd" ] || exit 0
case "$cmd" in *git*) ;; *) exit 0 ;; esac

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# Which checkout does this command act on? One that cds elsewhere or passes
# `git -C` is judged by that checkout's branch, not the session's.
dir=$(printf '%s' "$cmd" | sed -n 's/.*git[[:space:]]\{1,\}-C[[:space:]]\{1,\}\([^[:space:];&|]*\).*/\1/p' | head -1)
[ -n "$dir" ] || dir=$(printf '%s' "$cmd" | sed -n 's/^[[:space:]]*cd[[:space:]]\{1,\}"\{0,1\}\([^"[:space:];&|]*\)"\{0,1\}.*/\1/p' | head -1)
[ -n "$dir" ] || dir=.

# Only this repository is guarded. Another checkout the session works in (an
# ideas vault, a dotfiles repo) may move on main by design, so a command on
# it is allowed whatever its branch. Worktrees of this repository share its
# common git dir, so they are judged like the main checkout.
own=$(git -C "$(dirname "$0")" rev-parse --git-common-dir 2>/dev/null)
target=$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)
[ -n "$own" ] && [ -n "$target" ] || exit 0
own=$(cd "$(dirname "$0")" && cd "$own" && pwd -P)
target=$(cd "$dir" && cd "$target" && pwd -P)
[ "$own" = "$target" ] || exit 0

branch=$(git -C "$dir" branch --show-current 2>/dev/null)

# A commit while HEAD is on main. Checked at the moment of the commit, because
# the branch this session started on is not necessarily the branch it is on now.
if printf '%s' "$cmd" | grep -Eq '(^|[;&|]|&&)[[:space:]]*git[[:space:]]+([^;&|]*[[:space:]])?commit\b'; then
  if [ "$branch" = "main" ]; then
    deny "main is PR-only in this repo, and HEAD is on main right now. Branch first (git switch -c <branch>), then commit. If the work is already committed here, move it: git branch <branch> && git reset --hard origin/main."
  fi
fi

# A push that would land on main. Each refspec's destination is worked out
# (`+main`, `HEAD`, `x:refs/heads/main` all count), and a push naming no
# refspec pushes the current branch.
push=$(printf '%s' "$cmd" | grep -Eo '(^|[;&|]|&&)[[:space:]]*git[[:space:]]+([^;&|]*[[:space:]])?push([[:space:]][^;&|]*)?' | head -1)
if [ -n "$push" ]; then
  set -f
  words=()
  for w in ${push#*push}; do
    case "$w" in
      --all | --mirror) deny "main is PR-only in this repo, and $w would push it. Push your branch and open a PR." ;;
      -*) ;;
      *) words+=("$w") ;;
    esac
  done
  set +f
  # no refspec pushes the current branch (words[0] is the remote)
  [ ${#words[@]} -eq 0 ] && words=(origin)
  [ ${#words[@]} -eq 1 ] && words+=("$branch")
  for ref in "${words[@]:1}"; do
    ref=${ref#+}
    case "$ref" in *:*) dest=${ref##*:} ;; *) dest=$ref ;; esac
    [ "$dest" = HEAD ] && dest=$branch
    dest=${dest#refs/heads/}
    if [ "$dest" = main ]; then
      deny "main is PR-only in this repo, and this push would land on main. Push your branch instead and open a PR: git push -u origin <branch> && gh pr create."
    fi
  done
fi

exit 0
