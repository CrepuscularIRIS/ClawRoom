# Upstream PR Templates (Based on PR.md Protocol)

Use these templates when opening PRs to OpenRoom upstream.

## PR-A Template — `feat(mcp): minimal stdio MCP client bridge`

### Title
`feat(mcp): add minimal stdio MCP client bridge (server config, tool discovery, tool call)`

### Context & Intent
This PR adds a minimal MCP client bridge in OpenRoom dev backend so ChatPanel can discover and call external MCP tools without re-implementing agent logic in OpenRoom.

### Summary of Changes
- Added `GET/POST /api/mcp-servers` for MCP server config persistence.
- Added `GET /api/mcp-tools` for dynamic MCP tool discovery.
- Added `POST /api/mcp-call` for MCP tool invocation.
- Added frontend MCP tool adapter:
  - dynamic naming (`mcp__<server>__<tool>`)
  - normalized OpenAI tool schema projection.
- Added unit test for MCP naming and tool detection.

### Test Plan & Evidence
- `pnpm --dir apps/webuiapps test` (PASS)
- `pnpm --dir apps/webuiapps build` (PASS)
- API smoke:
  - `POST /api/mcp-servers` -> PASS
  - `GET /api/mcp-tools` -> PASS
  - `POST /api/mcp-call` -> PASS

### Risk & Rollback
- Risk: MCP server process failures or malformed stdio frames.
- Mitigation: timeout + structured error return (`errors[]` per server).
- Rollback: revert this PR; no schema migration required.

### Alignment
This is a minimal standards-based bridge aligned with issue #28 (MCP client support for multi-agent integration).

### AI Assistance Disclosure
Assisted-by: OpenAI Codex (implementation drafting, tests, and smoke scripting). Final validation and merge decision by human maintainer.

---

## PR-B Template — `feat(router): multi-agent session pager in ChatPanel`

### Title
`feat(router): add per-agent session paging for 5-mainagent router mode`

### Context & Intent
As router-mode conversations grow, message context in one panel becomes hard to navigate. This PR scopes and pages messages by active main agent to reduce cognitive load and improve operator accuracy.

### Summary of Changes
- Added per-agent message scoping in router mode.
- Added per-agent page state persistence in localStorage.
- Added `Prev / Latest / Next` pager controls.
- Added MCP tool-count badge for quick runtime visibility.

### Test Plan & Evidence
- `pnpm --dir apps/webuiapps test` (PASS)
- `pnpm --dir apps/webuiapps build` (PASS)
- Manual QA:
  - switch active agent -> message list changes deterministically
  - pagination boundary states handled correctly

### Risk & Rollback
- Risk: UX regression in ChatPanel due concurrent upstream refactors.
- Mitigation: isolate to router-only path; keep non-router path unchanged.
- Rollback: revert this PR only; no backend dependency.

### Alignment
Improves operator ergonomics for multi-agent workflows without changing model behavior.

### AI Assistance Disclosure
Assisted-by: OpenAI Codex (UI logic refactoring and verification scaffolding). Final UX acceptance by human maintainer.

---

## PR-C Template — `feat(mailbox): mailbox bridge tools + API`

### Title
`feat(mailbox): add OpenClaw mailbox bridge (send/poll/ack) with tool wiring`

### Context & Intent
This PR adds a lightweight mailbox protocol bridge so multi-agent workflows can exchange structured messages in OpenRoom router scenarios.

### Summary of Changes
- Added mailbox backend API:
  - `GET /api/openclaw-mailbox?action=poll`
  - `POST /api/openclaw-mailbox` (`send` / `ack`)
- Added frontend mailbox tools:
  - `openclaw_mailbox_send`
  - `openclaw_mailbox_poll`
  - `openclaw_mailbox_ack`
- Added mailbox unit tests.

### Test Plan & Evidence
- `pnpm --dir apps/webuiapps test` (PASS)
- `pnpm --dir apps/webuiapps build` (PASS)
- API smoke:
  - send -> poll -> ack -> poll (PASS)

### Risk & Rollback
- Risk: mailbox semantics may be perceived as OpenClaw-specific.
- Mitigation: payload is generic, file-backed, and optional by usage.
- Rollback: revert this PR; mailbox store file can be safely ignored/deleted.

### Alignment
Adds practical inter-agent communication capability for advanced orchestration workflows.

### AI Assistance Disclosure
Assisted-by: OpenAI Codex (protocol scaffold, tests, and smoke automation). Final architecture decisions by human maintainer.

---

## Reviewer Checklist (Attach to every PR)
- [ ] Scope is single-purpose and minimal
- [ ] No unrelated formatting churn
- [ ] Includes reproducible test evidence
- [ ] Includes risk/rollback notes
- [ ] Includes AI assistance disclosure
- [ ] Includes docs update if behavior changed
