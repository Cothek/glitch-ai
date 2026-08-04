#!/usr/bin/env bash
# Glitch Launcher - Switch mode and launch in one command
# Usage: ./glitch.sh [mode]

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$DIR/data/launch.log"

# Prefer bundled Node.js; fall back to system Node
if [ -x "$DIR/data/node/bin/node" ]; then
  NODE_CMD="$DIR/data/node/bin/node"
  export PATH="$DIR/data/node/bin:$PATH"
elif [ -x "$DIR/data/node/node" ]; then
  NODE_CMD="$DIR/data/node/node"
  export PATH="$DIR/data/node:$PATH"
elif command -v node >/dev/null 2>&1; then
  NODE_CMD="node"
else
  echo "Error: Node.js is required. Install from https://nodejs.org"
  exit 1
fi

mkdir -p "$DIR/data"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] glitch.sh $*" >> "$LOG_FILE" 2>&1

# Run node script with live output
"$NODE_CMD" "$DIR/scripts/glitch.mjs" "$@"
NODE_EXIT=$?

if [ "$NODE_EXIT" -ne 0 ]; then
    echo "Glitch exited with code $NODE_EXIT." >&2
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] glitch.sh exited with code $NODE_EXIT" >> "$LOG_FILE" 2>&1
fi
exit "$NODE_EXIT"