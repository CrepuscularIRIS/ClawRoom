#!/usr/bin/env bash
set -euo pipefail
if [ $# -ne 1 ]; then
  echo "Usage: $0 /path/to/OpenRoom"
  exit 1
fi
OPENROOM_DIR="$1"
PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$OPENROOM_DIR"
git apply "$PATCH_DIR/openroom-five-mainagent-router.patch"
echo "Patch applied. Run: pnpm --filter @openroom/webuiapps build"
