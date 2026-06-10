#!/bin/bash
# Free mode launcher. Pass --pick to force model selection menu.
DIR="$(cd "$(dirname "$0")" && pwd)"

# Prefer bundled Node.js; fall back to system
if [ -f "$DIR/data/node/node" ]; then
  NODE_CMD="$DIR/data/node/node"
  export PATH="$DIR/data/node:$PATH"
elif command -v node &>/dev/null; then
  NODE_CMD="node"
else
  echo "Error: Node.js is required. Install from https://nodejs.org"
  exit 1
fi

exec "$NODE_CMD" "$DIR/scripts/launch-free.mjs" "$@"
