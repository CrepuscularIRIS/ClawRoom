# Smoke Report

Date: 2026-04-04

## Environment
- OpenRoom dev server: `http://127.0.0.1:3001`
- Branch source: `ClawRoom main`
- Integration bundle: `openroom-agentic-suite`

## Validation Results

### 1) Unit tests
Command:
- `pnpm --dir apps/webuiapps test`

Result:
- PASS (`9 files`, `115 tests`)

### 2) Build
Command:
- `pnpm --dir apps/webuiapps build`

Result:
- PASS
- Existing warning: Sass legacy API / dynamic import chunking warnings (pre-existing)

### 3) MCP bridge APIs (end-to-end)
Configured local smoke MCP server:
- `name: smoke_log`
- `command: /home/yarizakurahime/.local/bin/node`
- `args: [/tmp/mcp-smoke-server-log.mjs]`

Requests:
- `POST /api/mcp-servers` -> PASS
- `GET /api/mcp-tools` -> PASS (`echo` tool discovered)
- `POST /api/mcp-call` (`echo`) -> PASS

Fix applied during validation:
- Corrected `content-length` regex in `vite.config.ts` parser.

### 4) Mailbox bridge APIs (end-to-end)
Requests:
- `POST /api/openclaw-mailbox` (`send`) -> PASS
- `GET /api/openclaw-mailbox?action=poll` -> PASS
- `POST /api/openclaw-mailbox` (`ack`) -> PASS
- `poll` after ack -> PASS (empty unless `includeAcked=1`)

## Notes
- `pnpm exec tsc --noEmit` currently fails due **pre-existing project-wide TS issues** unrelated to this bundle.
- Integration itself is validated via tests + build + live endpoint smoke.
