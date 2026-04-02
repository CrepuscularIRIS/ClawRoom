# ClawRoom

OpenClaw bridge plugins for connecting OpenClaw agent workflows with OpenRoom.

## Included

- `plugins/openclaw-openroom-bridge`
  - Bridge OpenClaw tools to local OpenRoom APIs (`/api/llm-config`, `/api/session-data`, `/api/characters`, `/api/mods`, `/api/llm-proxy`)
  - Includes health check + optional dev server lifecycle helpers.

## Quick Install (OpenClaw)

1. Copy this plugin folder to your OpenClaw extensions directory.
2. In `~/.openclaw/openclaw.json` add:
   - `plugins.allow` includes `openclaw-openroom-bridge`
   - `plugins.entries.openclaw-openroom-bridge.enabled = true`
   - `plugins.installs.openclaw-openroom-bridge` with `source: "path"`
3. Restart/reload Gateway.

## Tools Exposed

- `openroom_health`
- `openroom_dev_start`
- `openroom_dev_stop`
- `openroom_llm_config_get`
- `openroom_llm_config_set`
- `openroom_session_read`
- `openroom_session_write`
- `openroom_session_list`
- `openroom_session_delete`
- `openroom_session_reset`
- `openroom_characters_get`
- `openroom_characters_set`
- `openroom_mods_get`
- `openroom_mods_set`
- `openroom_llm_proxy`

## Commands Exposed

- `/openroom_health`
- `/openroom_up`
- `/openroom_down`
