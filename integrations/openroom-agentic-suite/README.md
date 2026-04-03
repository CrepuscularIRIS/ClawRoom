# OpenRoom Agentic Suite (PR-1/2/3)

This integration bundle lands the three staged improvements for OpenRoom ↔ OpenClaw:

1. **PR-1: MCP Client Minimal**
- Added stdio MCP client APIs in OpenRoom dev backend:
  - `GET/POST /api/mcp-servers`
  - `GET /api/mcp-tools`
  - `POST /api/mcp-call`
- Added frontend MCP tool bridge:
  - `src/lib/mcpBridgeTools.ts`
- Chat panel now dynamically injects MCP tools into tool calls.

2. **PR-2: Multi-Agent Session Pager / Switch**
- Chat router messages are scoped by active OpenClaw main agent.
- Added per-agent pagination controls in router mode.
- Keeps 5-agent routing UX clearer for long-running chats.

3. **PR-3: Mailbox Bridge + Tests**
- Added mailbox APIs in OpenRoom dev backend:
  - `GET /api/openclaw-mailbox?action=poll`
  - `POST /api/openclaw-mailbox` (`send` / `ack`)
- Added frontend mailbox tools:
  - `src/lib/openclawMailboxTools.ts`
- Added tests:
  - `mcpBridgeTools.test.ts`
  - `openclawMailboxTools.test.ts`

## Apply

```bash
bash integrations/openroom-agentic-suite/apply.sh /path/to/OpenRoom
```

This script:
- copies files into target OpenRoom repo
- runs `pnpm --dir apps/webuiapps test`
- runs `pnpm --dir apps/webuiapps build`

## Notes

- This bundle assumes your OpenRoom already includes the 5-agent router baseline.
- If you are using `openroom-five-mainagent-router` patch from this repo, apply that first.
