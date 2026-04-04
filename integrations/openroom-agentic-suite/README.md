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

4. **Router Execution Alignment (Direct / Hybrid)**
- Added router execution mode to ChatPanel:
  - `direct`: forward the user task to active OpenClaw main agent and return text result
  - `hybrid`: keep OpenRoom local tool loop active (app/file/memory/mailbox/mcp), and use OpenClaw delegation as a tool inside the same turn
- New command:
  - `/oc mode <direct|hybrid>`
- Why:
  - `direct` is stable for pure delegation chat
  - `hybrid` is required when you expect OpenRoom apps to be actively driven in the same conversation

5. **UI-First Routing + Upload Context + Action Reporting**
- Router controls are now fully UI-driven in chat router bar (commands are optional fallback).
- Added `New Session` for current main-agent lane (without typing `/oc ...`).
- Added `Actions` toggle in header to enable/disable "Actions taken" stream.
- Keep OpenRoom native bottom `+` upload as primary entry:
  - `png/zip` -> card import path (existing flow)
  - docs/images/other files -> attached to chat context via event bridge
- Chat composer no longer duplicates upload entry point.
- This improves OpenClaw alignment for OpenRoom app tasks (Diary/Twitter/Email/CyberNews etc.) in `hybrid` mode.

## Apply

```bash
bash integrations/openroom-agentic-suite/apply.sh /path/to/OpenRoom
```

This script:
- copies files into target OpenRoom repo
- runs `pnpm --dir apps/webuiapps test`
- runs `pnpm --dir apps/webuiapps build`

## Bundle Files (V3 Sync)

This bundle now ships the complete OpenRoom-side integration set (not only backend bridge):

- `apps/webuiapps/vite.config.ts`
- `apps/webuiapps/src/components/ChatPanel/index.tsx`
- `apps/webuiapps/src/components/ChatPanel/index.module.scss`
- `apps/webuiapps/src/components/Shell/index.tsx`
- `apps/webuiapps/src/lib/openclawAgentTools.ts`
- `apps/webuiapps/src/lib/openclawMailboxTools.ts`
- `apps/webuiapps/src/lib/mcpBridgeTools.ts`
- `apps/webuiapps/src/lib/__tests__/mcpBridgeTools.test.ts`
- `apps/webuiapps/src/lib/__tests__/openclawMailboxTools.test.ts`

## Optional Runtime Smoke

With OpenRoom dev server running, run:

```bash
bash integrations/openroom-agentic-suite/smoke_openclaw_bridge.sh
```

It probes:

- `POST /api/openclaw-agent`
- `GET /api/openclaw-mailbox?action=poll`
- `GET /api/mcp-tools`

## Notes

- This bundle assumes your OpenRoom already includes the 5-agent router baseline.
- If you are using `openroom-five-mainagent-router` patch from this repo, apply that first.
- If "Router On" appears to only return plain text and cannot drive apps, switch to `hybrid`.
