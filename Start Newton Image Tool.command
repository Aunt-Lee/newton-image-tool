#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required."
  echo "Install it from https://nodejs.org and run this shortcut again."
  read "?Press Enter to close..."
  exit 1
fi
node server.js
