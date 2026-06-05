#!/bin/bash
# Free mode launcher. Pass --pick to force model selection menu.
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required. Install from https://nodejs.org"
  exit 1
fi
exec node "$DIR/scripts/launch-free.mjs" "$@"
