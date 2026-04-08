# ClawRoom Product Design Decisions — V8

**Date**: 2026-04-08 | **Author**: Opus 4.6 | **Status**: Track 1 & Track 2 MVP decisions

---

## Why this doc exists

The previous design doc (`OPENROOM_AGENTIC_REDESIGN.md`) was comprehensive but bottom-up: it described every component and left implementation open. This doc is **top-down**: it records which product decisions were made, why, and what was deliberately left out.

Future sessions should read this first to understand the intent before touching code.

---

## 1. Core principle: visibility over interaction

**Decision**: In V8, the single most valuable UX improvement is making the 5 Beatless agents **visible at all times**, not making them more interactive.

**Rationale**: Users don't trust what they can't see. Right now OpenRoom looks like a generic desktop with an LLM chat sidebar. Users have no way to know that Kouka is running a cron job, that Satonus is waiting for a review, or that Snowdrop's last research turn was 40 minutes ago. Every click costs attention — we'd rather spend that budget on *showing* than on *making clicks more efficient*.

**Implication**: AgentBadge in every app chrome (Track 1A) is higher priority than redesigning the chat panel. Badge is built; chat panel is deliberately left alone.

---

## 2. What we built in this session

### 2.1 Track 1A — Agent Badge in App Chrome

**Files**:
- `OpenRoom/apps/webuiapps/src/lib/agentOwnership.ts` (new) — canonical agent ↔ app owner map
- `OpenRoom/apps/webuiapps/src/components/AgentBadge/index.tsx` (new)
- `OpenRoom/apps/webuiapps/src/components/AgentBadge/index.module.scss` (new)
- `OpenRoom/apps/webuiapps/src/components/AppWindow/index.tsx` (modified)
- `OpenRoom/apps/webuiapps/src/components/AppWindow/index.module.scss` (modified)

**What it does**: Every `AppWindow` title bar now renders a small pill badge showing the owning Beatless agent's color dot + initial + name. Hover shows tooltip with the agent's Beatless tendency. Click handler is wired but not yet connected to `executeOpenClawTool` (Phase B.2, next session).

**Product decision**: badge renders as `null` for apps with no declared owner. This avoids polluting OS-level windows with a generic "system" indicator. OS window stays clean.

**Non-decision**: the click handler currently does nothing. We deliberately shipped the visual without the interaction to avoid half-working affordances. A user who clicks and gets nothing is more confused than a user who only sees information. Next session wires it to a real action.

### 2.2 Track 2A — Beatless Adapter + REST/SSE API

**Files**:
- `ClawRoom/src/adapter/beatlessAdapter.mjs` (new, ~260 lines)
- `ClawRoom/src/api/server.mjs` (new, ~280 lines)
- `ClawRoom/src/package.json` (new)
- `ClawRoom/docs/BEATLESS_ADAPTER_SPEC.md` (new, full protocol doc)
- `ClawRoom/docs/PRODUCT_DESIGN_DECISIONS.md` (this file)

**What it does**: Provides a uniform HTTP API for any consumer (OpenRoom UI, CLI, webhooks, external apps) to read OpenClaw agent state. Zero external dependencies — pure Node built-ins only. Reads cron, sessions, memory, workspace files in parallel with fail-soft degradation.

**Product decision 1**: **Zero dependencies**. No Express, no Fastify, no socket.io. Just `node:http`. This keeps ClawRoom deployable with zero `npm install` friction and avoids another supply-chain attack vector. Cost: ~50 extra lines of boilerplate for routing and SSE. Benefit: `node api/server.mjs` just works forever.

**Product decision 2**: **Read-first, mutation-stubbed**. The `/api/tasks` endpoint accepts envelopes and echoes them back but does NOT yet dispatch to agents. This is deliberate — shipping the contract early lets consumers build against it before the real mailbox bus is ready (Architect.md P4-9 architectural work). Half the value of an API is the schema; we deliver the schema now.

**Product decision 3**: **Polling-based SSE, not push**. Real event push would require the adapter to subscribe to the OpenClaw gateway's event bus, which is WebSocket-only. Implementing a WS→SSE bridge is 200+ lines of state management. Instead: poll every 10s, compare snapshots, emit `snapshot` event on change, `heartbeat` otherwise. Latency: ≤10s. Code: ~30 lines. Upgrade path is documented.

**Product decision 4**: **Gateway degradation is a first-class feature**. If the gateway dies (we saw this in V5/V6 — 1006 abnormal closure), the adapter continues to serve cached state by reading local files. Users see "Lacia: last seen 2h ago, gateway offline" instead of a broken UI. This is the "failure is data" principle from the user's prompt.

---

## 3. What we deliberately skipped

### 3.1 Full ChatPanel rewrite — SKIPPED

**Why**: The existing `ChatPanel/index.tsx` is 2723 lines. It already imports `openclawAgentTools`, `openclawMailboxTools`, `mcpBridgeTools`, `memoryManager`, `imageGenTools`, and `fileTools` — the integration is 70% complete. Rewriting would:
- Risk breaking 5+ subsystems that currently work
- Cost 10-20 hours of careful migration
- Deliver mostly cosmetic wins (the functionality is already there)

**Alternative we chose**: Agent Badge + Adapter API give consumers everything they need to build better chat UIs externally. The existing ChatPanel remains the canonical in-browser experience; other consumers (CLI, webhooks, future custom UIs) use the adapter API. Let the chat panel evolve organically in additive patches, not rewrites.

### 3.2 Agent Hub drawer — SKIPPED

**Why**: The user's prompt explicitly marked this as "SKIP — Medium effort, Low reward" in the decision matrix. The adapter API already surfaces all the data a future Agent Hub would need (`GET /api/agents` returns everything). Building the Hub is purely presentation work that any consumer can now do against the stable API.

### 3.3 Task orchestration board — DESIGN-ONLY, NOT BUILT

**Why**: A kanban-style board is at least 400 lines of React with drag-and-drop, swimlane logic, and state management. The real mailbox bus (P4-9) doesn't exist yet, so any kanban would be a beautiful interface showing fake data. **Ship data layer first, then UI**. The adapter API defines the task lifecycle (proposed → claimed → in_progress → review_pending → delivery → completed); next session builds the board on top of real task envelopes.

### 3.4 Evidence console — DESIGN-ONLY, NOT BUILT

**Why**: Same reason as the task board. Needs real agent reasoning traces from the gateway's trace log (opik-openclaw plugin exists but isn't wired). Implementing the UI without the data source produces fake content.

---

## 4. What changed vs. the original prompt

The user's prompt said: "Start with Track 1A (Agent badges in app chrome) + Track 2A (Agent State API). These are the foundation everything else builds on. Report back when both are working."

We did that exactly. Nothing was added on top, nothing substituted. The two foundation features are built and the design doc is updated.

One nuance: the prompt said "Building working prototypes, not perfect implementations". We took that seriously:
- AgentBadge is functional but its click handler is intentionally a no-op (better than a fake action)
- Adapter API ships with a task-submit stub (better than no endpoint)
- SSE uses polling (works today, upgradable later)

These are deliberately not perfect — they're contracts you can now build against.

---

## 5. Next session priorities (in order)

1. **Wire AgentBadge click to `executeOpenClawTool`** — small patch in `AgentBadge/index.tsx`, needs a way to reach the chat panel state (or dispatch a custom event the chat panel listens to). Unblocks the "click to ask Kouka" flow end-to-end.

2. **Start the adapter server on gateway boot** — add a new plugin or systemd unit that runs `node ClawRoom/src/api/server.mjs` as a child of the gateway lifecycle. Currently it's a manual `node` invocation.

3. **OpenRoom consumes the adapter API** — add a `useAgentStates()` React hook that polls `GET /api/agents` every 10s and a fallback SSE subscription. This replaces the direct file-reading most apps would otherwise need for Agent Hub or Evidence Console work.

4. **Task dispatch implementation** — wire `/api/tasks` from MVP stub to a real mailbox drop so the task envelope actually reaches the target agent. Start with a file-based mailbox write, upgrade to real bus later.

5. **`owner_agent` field in meta.yaml for all 11 existing apps** — the Blog App has it. Propagate to the rest so AppWindow can read it from the registry instead of the hardcoded `APP_OWNERSHIP` map in `agentOwnership.ts`.

6. **Test coverage** — unit tests for `beatlessAdapter.mjs` probes, API integration tests per the spec's `§12 Testing` section.

---

## 6. Known issues and tradeoffs

| Issue | Tradeoff accepted |
|-------|-------------------|
| `APP_OWNERSHIP` is hardcoded in `agentOwnership.ts` | Fast to change, but duplicates the meta.yaml `owner_agent` field. Converge next session |
| AgentBadge click is a no-op | Better than a fake action. Wires up next session |
| Adapter API is unauthenticated by default | Fine for `127.0.0.1` local dev. Set `CLAWROOM_AUTH_TOKEN` for any non-local exposure |
| SSE uses 10s polling, not push | Latency cost ≤10s. Acceptable for a control center; upgradable when gateway event bus is accessible |
| `/api/tasks` is MVP stub | Contract-first: consumers can integrate now, real dispatch comes later |
| Adapter is read-only | Intentional. Mutations go through `./openclaw-local` CLI. Reduces blast radius |
| Pre-existing OpenRoom build is broken (`unplugin` missing) | Not our scope; Blog App passes TypeScript check independently |

---

## 7. Metrics that would justify further investment

- **If the adapter API gets >100 req/min**: build the real push channel instead of polling
- **If users manually call the `/api/tasks` stub more than 10 times**: build real mailbox dispatch
- **If agent badge clicks are logged but have nothing to do**: build the chat-panel prefill
- **If the Blog cron runs successfully 5+ times**: build the Blog App's "ask Kouka to generate" flow end-to-end

We don't build speculative features. We ship contracts, observe usage, and iterate.

---

*V8 product design — build visibility first, contracts second, interaction last. Every skipped feature is a conscious deferral to protect the working parts.*
