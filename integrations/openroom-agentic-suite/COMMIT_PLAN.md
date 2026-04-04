# 3-Commit Submission Plan (Clean)

This plan is for upstream submission (OpenRoom) with minimum review friction.

## Commit 1: feat(mcp): add minimal stdio MCP client bridge

### Scope
- Add MCP server config/list/call APIs in dev backend.
- Add frontend MCP tool bridge model + dynamic tool naming.
- Add MCP unit tests.

### Files
- `apps/webuiapps/vite.config.ts` (MCP endpoints only)
- `apps/webuiapps/src/lib/mcpBridgeTools.ts`
- `apps/webuiapps/src/lib/__tests__/mcpBridgeTools.test.ts`

### Why first
- Directly addresses MCP integration request.
- Generic and independent of OpenClaw-specific mailbox semantics.

## Commit 2: feat(router): add multi-agent session pager in ChatPanel

### Scope
- Add per-agent message scoping and paging UX in router mode.
- Persist page state by active main agent.
- Keep ChatPanel behavior deterministic for long-running sessions.

### Files
- `apps/webuiapps/src/components/ChatPanel/index.tsx` (pager/router UI logic)
- `apps/webuiapps/src/components/ChatPanel/index.module.scss` (pager styles)

### Why second
- UX-only enhancement; easy to evaluate after MCP base is merged.

## Commit 3: feat(mailbox): add mailbox bridge tools and API

### Scope
- Add mailbox `send/poll/ack` backend endpoints.
- Add mailbox tool definitions + execution adapter in frontend.
- Add mailbox unit tests.

### Files
- `apps/webuiapps/vite.config.ts` (mailbox endpoints only)
- `apps/webuiapps/src/lib/openclawMailboxTools.ts`
- `apps/webuiapps/src/lib/__tests__/openclawMailboxTools.test.ts`
- `apps/webuiapps/src/components/ChatPanel/index.tsx` (tool wiring)

### Why third
- OpenClaw-oriented workflow feature; easiest to review after MCP/router baseline.

## Suggested PR Sequence
1. PR-A: Commit 1 only
2. PR-B: Commit 2 (rebase on PR-A)
3. PR-C: Commit 3 (rebase on PR-A or PR-B)

## Validation Gate (for each commit)
- `pnpm --dir apps/webuiapps test`
- `pnpm --dir apps/webuiapps build`
- For commit 1/3 additionally run API smoke with curl
