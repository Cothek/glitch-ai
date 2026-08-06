#!/usr/bin/env bash
# sync-user.sh - Bash port of scripts/sync-user.ps1
#
# Sync user memory files between machines via the private glitch-user-troy repo.
#
# The user/ directory is a standalone nested git repo (not a submodule of
# glitch-ai). It has its own remote. Use this script to sync memory files
# between machines.
#
# Usage:
#   ./scripts/sync-user.sh                Status (behind/ahead) + hints
#   ./scripts/sync-user.sh --status       Same as no flags
#   ./scripts/sync-user.sh --push         Commit pending changes and push
#   ./scripts/sync-user.sh --push --message "notes"   Custom commit message
#   ./scripts/sync-user.sh --pull         Pull latest from origin/main
#   ./scripts/sync-user.sh --push --pull  Full round-trip sync
#   ./scripts/sync-user.sh -h|--help      Show this help
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_DIR="$ROOT/user"

PUSH=0
PULL=0
STATUS=0
MESSAGE=""

usage() {
  cat <<'EOF'
sync-user.sh - Sync user memory files between machines.

Usage: ./scripts/sync-user.sh [--push] [--pull] [--status] [--message "..."]

  --push              Commit any pending changes and push to origin/main.
  --pull              Pull latest user data from origin/main.
  --status            Show behind/ahead status only (no changes made).
  --message "..."     Custom commit message for push mode.
                      Default: "memory: auto-sync <timestamp>"
  -h, --help          Show this help.

Examples:
  ./scripts/sync-user.sh --status
  ./scripts/sync-user.sh --push --message "memory: notes from laptop session"
  ./scripts/sync-user.sh --pull
  ./scripts/sync-user.sh --push --pull    # full round-trip sync
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH=1 ;;
    --pull) PULL=1 ;;
    --status) STATUS=1 ;;
    --message)
      shift
      if [ $# -eq 0 ]; then
        echo "ERROR: --message requires an argument" >&2
        exit 1
      fi
      MESSAGE="$1"
      ;;
    --message=*) MESSAGE="${1#--message=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

# --- Validate user/ is a git repo ---
if [ ! -d "$USER_DIR/.git" ]; then
  echo "ERROR: user/ is not a git repository. No .git directory found." >&2
  echo "Run: cd user && git init && git remote add origin <url> && git add -A && git commit -m 'init'" >&2
  exit 1
fi

cd "$USER_DIR"

# --- Check remote ---
remote_url="$(git remote get-url origin 2>/dev/null || true)"
if [ -z "$remote_url" ]; then
  echo "ERROR: No 'origin' remote configured in user/" >&2
  echo "Run: cd user && git remote add origin <url>" >&2
  exit 1
fi

# --- Fetch to get latest remote state ---
echo "Fetching from origin..."
git fetch origin main 2>&1 || true

# --- Status: behind / ahead ---
behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || true)"
ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || true)"
case "$behind" in ''|*[!0-9]*) behind=0;; esac
case "$ahead" in ''|*[!0-9]*) ahead=0;; esac

# --- Check for dirty files ---
dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
case "$dirty" in ''|*[!0-9]*) dirty=0;; esac

echo "============================================================"
echo "  GLITCH USER MEMORY SYNC"
echo "  Remote: $remote_url"
echo "============================================================"
echo "  Local branch: main"
if [ "$dirty" -gt 0 ]; then
  echo "  Uncommitted changes: $dirty file(s)"
else
  echo "  Uncommitted changes: none"
fi
if [ "$ahead" -gt 0 ]; then
  echo "  Ahead of origin: $ahead commit(s)"
else
  echo "  Ahead of origin: 0 commit(s)"
fi
if [ "$behind" -gt 0 ]; then
  echo "  Behind origin: $behind commit(s)"
else
  echo "  Behind origin: 0 commit(s)"
fi
echo "============================================================"

# --- Decide action ---
status_only=0
do_push=0
do_pull=0
if [ "$STATUS" -eq 1 ] || { [ "$PUSH" -eq 0 ] && [ "$PULL" -eq 0 ]; }; then
  status_only=1
fi
if [ "$PUSH" -eq 1 ] || { [ "$PULL" -eq 0 ] && [ "$STATUS" -eq 0 ]; }; then
  do_push=1
fi
if [ "$PULL" -eq 1 ] || { [ "$PUSH" -eq 0 ] && [ "$STATUS" -eq 0 ]; }; then
  do_pull=1
fi

if [ "$status_only" -eq 1 ]; then
  if [ "$dirty" -gt 0 ] || [ "$ahead" -gt 0 ]; then
    echo "  Run: ./scripts/sync-user.sh --push  (to push changes)"
  fi
  if [ "$behind" -gt 0 ]; then
    echo "  Run: ./scripts/sync-user.sh --pull  (to pull latest)"
  fi
  if [ "$dirty" -eq 0 ] && [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then
    echo "  Everything is in sync."
  fi
  echo ""
  echo "  ./scripts/sync-user.sh (no flags) = interactive mode"
  echo "  ./scripts/sync-user.sh --push --pull  = full round-trip"
  exit 0
fi

# --- Push mode ---
if [ "$do_push" -eq 1 ] && { [ "$dirty" -gt 0 ] || [ "$ahead" -gt 0 ]; }; then
  if [ "$dirty" -gt 0 ]; then
    commit_msg="${MESSAGE:-memory: auto-sync $(date '+%Y-%m-%d %H:%M')}"
    echo "Committing $dirty file(s)..."
    git add -A 2>&1 || true
    git commit -m "$commit_msg" 2>&1 || true
    echo "  Done."
  fi

  echo "Pushing to origin/main..."
  if git push origin main 2>&1; then
    echo "  Done."
  else
    echo "  PUSH FAILED" >&2
    echo "  Check your network and GitHub credentials." >&2
  fi
elif [ "$do_push" -eq 1 ]; then
  echo "Nothing to push. Working tree is clean and up to date."
fi

# --- Pull mode ---
if [ "$do_pull" -eq 1 ] && [ "$behind" -gt 0 ]; then
  echo "Pulling from origin/main..."
  if git pull origin main 2>&1; then
    new_head="$(git rev-parse --short HEAD 2>/dev/null || true)"
    echo "  Done. HEAD is now $new_head"
  else
    echo "  PULL FAILED" >&2
    echo "  You may have conflicting local changes." >&2
  fi
elif [ "$do_pull" -eq 1 ]; then
  echo "Already up to date with origin/main."
fi

# --- Final summary ---
new_behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || true)"
if [ -z "$new_behind" ]; then
  new_behind="?"
fi
if [ "$new_behind" -eq 0 ] 2>/dev/null; then
  echo "Result: In sync with origin/main."
else
  echo "Result: $new_behind commit(s) behind origin/main remaining."
fi

exit 0