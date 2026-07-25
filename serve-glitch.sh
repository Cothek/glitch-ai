#!/bin/bash
# serve-glitch.sh - Mac/Linux launcher for Glitch in SERVER MODE
#
# Server mode runs the Glitch web UI as a long-lived background process,
# accessible remotely via Cloudflare Tunnel (or any reverse proxy).
# This is the equivalent of serve-glitch.bat on Windows.
#
# Usage:
#   ./serve-glitch.sh                  # Start server with default config
#   ./serve-glitch.sh --port 4102      # Pass args through to serve.mjs
#
# For interactive (foreground) mode, use launch-glitch.sh instead.

DIR="$(cd "$(dirname "$0")" && pwd)"

# Auto-bootstrap if Node.js not available (neither bundled nor system)
# Mirrors the bootstrap logic in launch-glitch.sh so server mode works
# on a fresh checkout without requiring a manual Node.js install.
if [ ! -f "$DIR/data/node/bin/node" ] && [ ! -f "$DIR/data/node/node" ] && ! command -v node &>/dev/null; then
  echo "Bootstrapping Glitch (first-time setup - downloading Node.js)..."
  # Resolve the latest LTS version from nodejs.org; fall back to a known-good default
  NODE_VER=$(curl -sL https://nodejs.org/dist/index.json 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print([r['version'] for r in d if r['lts']][0])" 2>/dev/null || echo "v22.14.0")
  OS=$(uname | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
  mkdir -p "$DIR/data/downloads"
  # Download via curl if available, otherwise wget
  if command -v curl &>/dev/null; then
    curl -fsL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-$OS-$ARCH.tar.gz" -o "$DIR/data/downloads/node.tar.gz"
  elif command -v wget &>/dev/null; then
    wget -q "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-$OS-$ARCH.tar.gz" -O "$DIR/data/downloads/node.tar.gz"
  fi
  # Extract into the bundled data/node/ directory
  if [ -f "$DIR/data/downloads/node.tar.gz" ]; then
    mkdir -p "$DIR/data/node"
    tar -xzf "$DIR/data/downloads/node.tar.gz" -C "$DIR/data/downloads/"
    cp -r "$DIR/data/downloads/node-$NODE_VER-$OS-$ARCH/"* "$DIR/data/node/"
    rm -rf "$DIR/data/downloads/node-$NODE_VER-$OS-$ARCH" "$DIR/data/downloads/node.tar.gz"
  fi
  # Bail out clearly if bootstrap failed so the user knows to install manually
  if [ ! -f "$DIR/data/node/bin/node" ] && [ ! -f "$DIR/data/node/node" ]; then
    echo "Bootstrap failed - Node.js still missing. Please install Node.js manually."
    exit 1
  fi
fi

# Prefer bundled Node.js; fall back to system Node if present
if [ -f "$DIR/data/node/bin/node" ]; then
  NODE_CMD="$DIR/data/node/bin/node"
  export PATH="$DIR/data/node/bin:$PATH"
elif [ -f "$DIR/data/node/node" ]; then
  NODE_CMD="$DIR/data/node/node"
  export PATH="$DIR/data/node:$PATH"
elif command -v node &>/dev/null; then
  NODE_CMD="node"
else
  echo "Error: Node.js is required. Install from https://nodejs.org"
  exit 1
fi

# Hand off to serve.mjs (server mode entry point) with all CLI args forwarded
exec "$NODE_CMD" "$DIR/scripts/serve.mjs" "$@"
