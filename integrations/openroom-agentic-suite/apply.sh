#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 /path/to/OpenRoom"
  exit 1
fi

OPENROOM_DIR="$1"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILES_DIR="$ROOT_DIR/files"

if [ ! -d "$OPENROOM_DIR/apps/webuiapps" ]; then
  echo "Target does not look like OpenRoom repo: $OPENROOM_DIR"
  exit 1
fi

rsync -a "$FILES_DIR/" "$OPENROOM_DIR/"

echo "[1/2] Running tests..."
(cd "$OPENROOM_DIR" && pnpm --dir apps/webuiapps test)

echo "[2/2] Running build..."
(cd "$OPENROOM_DIR" && pnpm --dir apps/webuiapps build)

echo "Applied OpenRoom Agentic Suite successfully."
