# Delivery Phases

## Phase 1 — MCP Client Support (Minimal)
- Backend stdio MCP bridge endpoints in `vite.config.ts`.
- Frontend dynamic MCP tool injection via `mcpBridgeTools.ts`.
- ChatPanel tool execution path includes MCP calls.

## Phase 2 — Multi-Agent Session Pager
- Router mode message scoping by `activeMainAgent`.
- Per-agent page state in localStorage.
- Header shows MCP tool count and pager controls.

## Phase 3 — Mailbox Bridge + Baseline Tests
- Mailbox backend API with `send/poll/ack`.
- Mailbox tool definitions + execution adapter in frontend.
- Two new tests for MCP naming and Mailbox tool exposure.

## Smoke Validation
- `pnpm --dir apps/webuiapps test`
- `pnpm --dir apps/webuiapps build`

## Phase 4 — V3 Bundle Completeness
- Ensure the integration bundle includes both backend and frontend files.
- Keep Router direct/hybrid, pager, upload context, MCP, and mailbox in one portable package.
- Add runtime smoke script to quickly verify OpenClaw bridge endpoints when dev server is up.
