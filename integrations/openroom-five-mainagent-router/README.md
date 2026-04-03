# OpenRoom Five MainAgent Router

This integration turns OpenRoom ChatPanel into a router for OpenClaw 5 MainAgents.

## What it enables

- Route chat to one selected main agent continuously:
  - `lacia` (orchestrator)
  - `methode` (builder)
  - `kouka` (delivery/content)
  - `snowdrop` (research)
  - `satonus` (security/audit)
- Keep per-agent session continuity (session id cache)
- Manual router commands in chat:
  - `/oc use <agent>`
  - `/oc off`
  - `/oc status`
  - `/oc <agent> <task>`
- Tool-level delegation support via `delegate_to_main_agent`
- Backend bridge API: `POST /api/openclaw-agent`

## Security

- Loopback-only by default.
- For network clients, set env var:

```bash
export OPENCLAW_BRIDGE_TOKEN="your-strong-token"
```

- Frontend sends token from localStorage key:

```js
localStorage.setItem('openroom-openclaw-bridge-token', 'your-strong-token')
```

## Apply to OpenRoom

From your OpenRoom repository root:

```bash
git apply /path/to/ClawRoom/integrations/openroom-five-mainagent-router/openroom-five-mainagent-router.patch
pnpm --filter @openroom/webuiapps build
```

Restart OpenRoom dev server after applying.

## Notes

- This is an OpenRoom integration patch, not an OpenClaw plugin-only change.
- It works together with your existing `openclaw-openroom-bridge` plugin.
