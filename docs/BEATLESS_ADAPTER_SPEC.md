# Beatless Adapter Specification

**Version**: 0.1.0 | **Date**: 2026-04-08 | **Status**: MVP implementation

---

## 1. Purpose

The Beatless Adapter is ClawRoom's runtime layer that makes the 5 Beatless main agents (Lacia / Methode / Satonus / Snowdrop / Kouka) addressable by **any frontend** — OpenRoom desktop, terminal CLI, external webhooks, custom dashboards — through a single uniform contract.

Without the adapter, each consumer has to reinvent the same plumbing: parse `.openclaw/cron/jobs.json`, scan `.openclaw/agents/<id>/sessions/`, probe `openclaw-local gateway status`, etc. With the adapter, a consumer makes one HTTP request and gets a complete, versioned `AgentState` object.

**Non-goal**: this is not a replacement for the OpenClaw gateway. Mutations (sending a task, killing a session, invoking an rc call) still go through `./openclaw-local` CLI or the gateway RPC bridge. The adapter is **read-focused** with a `/api/tasks` stub for future mailbox wiring.

---

## 2. Architecture

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ OpenRoom UI  │   │ CLI client   │   │ Webhook      │   │ External app │
│ (ChatPanel)  │   │ (curl/jq)    │   │ (GitHub etc) │   │              │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │                  │
       └──────────────────┴──────────────────┴──────────────────┘
                                   │
                                   ▼
                   ┌───────────────────────────────┐
                   │  ClawRoom API Server          │
                   │  (node:http, zero deps)       │
                   │                               │
                   │   GET  /api/health            │
                   │   GET  /api/agents            │
                   │   GET  /api/agents/:id/state  │
                   │   GET  /api/events  (SSE)     │
                   │   POST /api/tasks  (MVP stub) │
                   └──────────────┬────────────────┘
                                  │
                                  ▼
                   ┌───────────────────────────────┐
                   │  Beatless Adapter Core        │
                   │  (src/adapter/*.mjs)          │
                   │                               │
                   │   collectAllAgentStates()     │
                   │   collectAgentState(id)       │
                   │   probeCronJobs()             │
                   │   probeAgentSessions()        │
                   │   probeAgentMemory()          │
                   │   probeGatewayHealth()        │
                   │   probeAgentWorkspace()       │
                   └──────────────┬────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
          ┌──────────────┐ ┌────────────┐ ┌──────────────┐
          │ openclaw-    │ │ .openclaw/ │ │ .openclaw/   │
          │ local CLI    │ │ cron/      │ │ agents/      │
          │ (subprocess) │ │ memory/    │ │ workspace-*/ │
          └──────────────┘ └────────────┘ └──────────────┘
```

### 2.1 Layering rules

1. **Adapter core** (`src/adapter/beatlessAdapter.mjs`) is pure Node ESM, zero external dependencies, read-only.
2. **API server** (`src/api/server.mjs`) is a thin HTTP wrapper around the adapter core. Zero external dependencies.
3. **Consumers** (OpenRoom, CLI, webhooks) never touch `.openclaw/` directly. They go through the API.
4. **Mutations** are out of scope for the adapter. The `/api/tasks` stub accepts envelopes and returns them as MVP; a later phase wires to the real mailbox bus.

---

## 3. Data contracts

### 3.1 `AgentState`

Full state of a single Beatless main agent. Returned by `GET /api/agents/:id/state`.

```typescript
interface AgentState {
  /** Main agent id — one of 'lacia'|'methode'|'satonus'|'snowdrop'|'kouka' */
  agent: MainAgentId;
  /** Capitalised name for UI display */
  displayName: string;
  /** Beatless specialty tendency (from SOUL.md) */
  tendency: string;
  /** Gateway-level availability */
  status: 'online' | 'offline' | 'unknown';
  /** Activity heuristic based on last state change */
  activity: 'idle' | 'working' | 'blocked' | 'unknown';
  /** ms epoch of most recent detected activity across all signals */
  lastActivityMs: number | null;
  /** All cron jobs owned by this agent (from `openclaw cron list --json`) */
  cronJobs: CronJobRecord[];
  /** Next scheduled cron run or null */
  nextCronRun: { at: string; ms: number } | null;
  /** Last N session records from sessions.json, newest first */
  recentSessions: SessionRecord[];
  /** Memory SQLite metadata (proxy for "when did agent last think") */
  memory: { path: string; sizeBytes: number; lastModifiedMs: number } | null;
  /** workspace-<id>/*.md files with mtimes (config change tracking) */
  workspaceFiles: Array<{ name: string; lastModifiedMs: number }>;
}
```

### 3.2 `GlobalSnapshot`

Returned by `GET /api/agents` and SSE `snapshot` events.

```typescript
interface GlobalSnapshot {
  gateway: { ok: boolean; lastCheckedMs: number };
  agents: AgentState[]; // always 5 entries in canonical order
  collectedAtMs: number;
}
```

### 3.3 `TaskEnvelope` (MVP stub)

Submitted to `POST /api/tasks`. Echo-only in MVP — future work wires to the real mailbox bus.

```typescript
interface TaskEnvelope {
  taskId: string;                    // generated server-side
  agent: MainAgentId;                // which agent owns this task
  taskType: string;                  // e.g. 'blog.generate', 'code.review'
  payload: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high';
  callbackUrl?: string;              // optional webhook for completion
  submittedAtMs: number;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  source: string;                    // 'clawroom-api' | 'openroom' | ...
}
```

---

## 4. API endpoints

### 4.1 `GET /api/health`

No auth required. Returns adapter + gateway liveness.

```json
{
  "adapter": { "ok": true, "version": "0.1.0" },
  "gateway": { "ok": true, "lastCheckedMs": 1775655600000 },
  "clawroom": {
    "root": "/home/yarizakurahime/claw",
    "port": 17890,
    "host": "127.0.0.1",
    "authEnabled": false
  },
  "collectedAtMs": 1775655600000
}
```

### 4.2 `GET /api/agents`

Returns `GlobalSnapshot` with all 5 agents. Auth required if configured.

### 4.3 `GET /api/agents/:id/state`

Returns `AgentState` for the specified agent. `:id` must be one of the 5 canonical ids. 404 on unknown id.

### 4.4 `GET /api/events` (SSE)

Server-Sent Events stream. Emits on a 10-second poll interval:

- `snapshot` event — full `GlobalSnapshot` when state changes since last tick
- `heartbeat` event — small payload when state is unchanged (prevents client timeout)
- `error` event — on any probe failure

Clients should reconnect on disconnect; the server handles graceful cleanup via `request.on('close')`.

### 4.5 `POST /api/tasks`

Submits a `TaskEnvelope`. MVP stub: returns 202 with the accepted envelope but does NOT yet dispatch to the agent. This endpoint is deliberately wired up early so consumers can build against the contract before the real mailbox bus exists.

Request body:
```json
{
  "agent": "kouka",
  "taskType": "blog.generate",
  "payload": { "topic": "OpenClaw V8", "tone": "technical" },
  "priority": "normal",
  "callbackUrl": "https://example.com/webhook/task-complete"
}
```

Response (202 Accepted):
```json
{
  "accepted": true,
  "task": {
    "taskId": "task_1775655600000_abc12345",
    "agent": "kouka",
    "taskType": "blog.generate",
    "payload": { "topic": "OpenClaw V8", "tone": "technical" },
    "priority": "normal",
    "callbackUrl": "https://example.com/webhook/task-complete",
    "submittedAtMs": 1775655600000,
    "status": "queued",
    "source": "clawroom-api"
  },
  "note": "MVP stub — task envelope not yet dispatched to agent."
}
```

---

## 5. Authentication

The adapter supports bearer-token auth via `--auth-token=<token>` or `CLAWROOM_AUTH_TOKEN` env var. When configured:

- All endpoints except `/api/health` require `Authorization: Bearer <token>`
- 401 response if missing or incorrect

When **not** configured (default), the adapter runs in **open mode**. This is safe for `127.0.0.1`-bound servers on a single user machine. External exposure MUST set an auth token.

---

## 6. Running the adapter

```bash
# Install (no npm install needed — zero deps)
cd /home/yarizakurahime/claw/ClawRoom/src

# Start with defaults (127.0.0.1:17890, no auth)
node api/server.mjs

# Custom port + auth
node api/server.mjs --port=18000 --host=0.0.0.0 --auth-token=my-secret

# Via package.json scripts
pnpm start
pnpm dev  # --watch for auto-reload

# One-shot probe (no server, prints full snapshot)
pnpm probe:agents
```

The server uses only Node built-ins (`node:http`, `node:fs/promises`, `node:child_process`). No `npm install` step. Works with Node 18.17+.

---

## 7. Example consumer flows

### 7.1 OpenRoom UI fetches all agent states

```typescript
const response = await fetch('http://127.0.0.1:17890/api/agents', {
  headers: { Authorization: `Bearer ${import.meta.env.VITE_CLAWROOM_TOKEN}` },
});
const snapshot = await response.json();
// snapshot.agents[*] → render in Agent Hub or badges
```

### 7.2 CLI probe

```bash
curl -s http://127.0.0.1:17890/api/agents/kouka/state | jq '.nextCronRun'
# → { "at": "2026-04-10T10:00:00.000Z", "ms": 1775822400000 }
```

### 7.3 SSE subscription from browser

```javascript
const es = new EventSource('http://127.0.0.1:17890/api/events');
es.addEventListener('snapshot', (e) => {
  const snapshot = JSON.parse(e.data);
  updateAgentHub(snapshot);
});
es.addEventListener('heartbeat', () => { /* keep alive */ });
es.addEventListener('error', (e) => console.warn('stream error', e));
```

### 7.4 External webhook submits task

```bash
curl -X POST http://127.0.0.1:17890/api/tasks \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer my-secret' \
  -d '{"agent":"methode","taskType":"github.pr.review","payload":{"pr":"owner/repo#123"}}'
```

---

## 8. Beatless-specific protocol semantics

### 8.1 Task lifecycle

```
proposed → claimed → in_progress → review_pending → delivery → completed
                  ↓
               blocked → (stop-loss) → abandoned
```

This lifecycle is recognized by the adapter's task status field. The real mailbox bus (future phase) will propagate these transitions via the event stream.

### 8.2 Activity heuristic

`AgentState.activity` is computed from `lastActivityMs`:

| Age | Value |
|-----|-------|
| < 5 min | `working` |
| < 60 min | `idle` |
| ≥ 60 min | `idle` (extended idle — could be `unknown` in future) |
| no signal at all | `unknown` |

`blocked` is reserved for future use — requires explicit signal from heartbeat or mailbox.

### 8.3 Cron → agent mapping

Cron jobs carry `agentId` in the canonical schema. The adapter filters cron jobs by `agentId === requestedAgent` to populate `AgentState.cronJobs`. If a job uses the legacy `agent` field (non-canonical), the adapter also accepts it.

### 8.4 Gateway degradation

If `openclaw-local gateway status` fails or times out, the adapter returns `gateway: { ok: false }` and marks agent `status: 'offline'` for all 5. Individual agent probes (sessions, memory, workspace) continue to work — a dead gateway does not zero out the UI.

---

## 9. Failure modes and degraded behavior

| Failure | Adapter response |
|---------|------------------|
| `openclaw-local` binary missing | cron probe falls back to reading `.openclaw/cron/jobs.json` directly |
| `sessions.json` missing | `recentSessions: []` |
| `memory/<id>.sqlite` missing | `memory: null` |
| `workspace-<id>/` missing | `workspaceFiles: []` |
| All probes fail for an agent | `AgentState` with `status: 'unknown'`, `activity: 'unknown'`, all arrays empty |
| Whole gateway dead | `GlobalSnapshot.gateway.ok = false`, all agents `status: 'offline'` but still return their cached state |

**Principle**: partial state is always better than an HTTP error. The adapter never throws during collection — it returns degraded data so UIs can show "Lacia: last seen 2h ago, gateway offline" instead of crashing.

---

## 10. Future work

- **P1**: Real mailbox bus wiring for `/api/tasks` — currently stub. Requires the Architect.md §Mailbox 8-type protocol.
- **P1**: Direct gateway event subscription for true push semantics (replace 10s SSE polling).
- **P2**: Memory SQLite introspection — currently only `stat()` mtime. Read recent entries for richer "last thought" display.
- **P2**: Writeable session endpoints (`POST /api/agents/:id/session` to force a heartbeat).
- **P2**: Task callback dispatcher — when a task completes, POST to `callbackUrl`.
- **P3**: WebSocket upgrade path for bidirectional agent control.
- **P3**: Prometheus `/metrics` endpoint for external monitoring.

---

## 11. Relationship to existing components

| Component | Role | Relationship to adapter |
|-----------|------|------------------------|
| `.openclaw/extensions/openclaw-openroom-bridge/` | OpenClaw plugin: OpenClaw → OpenRoom outbound tools | Adapter reads OpenClaw state; bridge is orthogonal (bridge mutates OpenRoom, adapter reads OpenClaw) |
| `OpenRoom apps/webuiapps/src/lib/openclawAgentTools.ts` | LLM tool: chat → agent delegation | Adapter-agnostic — could be rewritten to use adapter API instead of direct gateway calls |
| `OpenRoom apps/webuiapps/src/lib/openclawMailboxTools.ts` | LLM tool: chat → mailbox | Same — future replacement target |
| `OpenClaw gateway :18789` | WebSocket gateway | Adapter probes it via `openclaw-local gateway status`; does not compete |
| `ClawRoom/integrations/openroom-*` | Legacy integration patches | Static files, not runtime components |

**Design intent**: ClawRoom eventually becomes the single entry point for everything frontend-facing. OpenRoom's current direct `openclawAgentTools.ts` / `openclawMailboxTools.ts` integration is acceptable as-is; the adapter provides an alternative path for external consumers without forcing a rewrite.

---

## 12. Testing

### 12.1 Unit smoke

```bash
cd ClawRoom/src
pnpm probe:agents  # prints full snapshot JSON, exit 0 on success
```

Expected output: valid JSON with `agents: [5 entries]` and a `gateway` section. Missing data is fine (e.g., new deployment with no cron yet).

### 12.2 Integration smoke

```bash
node api/server.mjs &
SERVER_PID=$!
sleep 2
curl -s http://127.0.0.1:17890/api/health | jq '.adapter.ok'  # → true
curl -s http://127.0.0.1:17890/api/agents | jq '.agents | length'  # → 5
curl -s http://127.0.0.1:17890/api/agents/kouka/state | jq '.agent'  # → "kouka"
kill $SERVER_PID
```

### 12.3 SSE smoke

```bash
node api/server.mjs &
SERVER_PID=$!
sleep 2
timeout 12 curl -N http://127.0.0.1:17890/api/events 2>&1 | grep -c "event: "
# → at least 2 (first snapshot + first heartbeat or second snapshot)
kill $SERVER_PID
```

---

*Beatless Adapter 0.1.0 — ClawRoom runtime layer for uniform agent state. Zero deps, read-first, degradable. Built to survive a dead gateway.*
