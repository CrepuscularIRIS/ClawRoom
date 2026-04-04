#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${OPENROOM_BASE_URL:-http://127.0.0.1:3001}"
AGENT="${OPENCLAW_SMOKE_AGENT:-lacia}"
MSG="${OPENCLAW_SMOKE_MESSAGE:-Reply exactly: BRIDGE_OK}"

echo "[smoke] base_url=$BASE_URL"

echo "[smoke] /api/openclaw-agent"
curl -sfS "$BASE_URL/api/openclaw-agent" \
  -H 'content-type: application/json' \
  -X POST \
  --data "{\"agent\":\"$AGENT\",\"message\":\"$MSG\"}" \
  | jq '.ok' >/dev/null

echo "[smoke] /api/openclaw-mailbox?action=poll"
curl -sfS "$BASE_URL/api/openclaw-mailbox?action=poll&agent=lacia&limit=1" \
  | jq '.ok' >/dev/null

echo "[smoke] /api/mcp-tools"
curl -sfS "$BASE_URL/api/mcp-tools" \
  | jq '.ok' >/dev/null

echo "[smoke] PASS"
