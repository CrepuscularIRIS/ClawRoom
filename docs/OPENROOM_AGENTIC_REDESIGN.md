# OpenRoom Agentic Redesign — Immersive OpenClaw Frontend

**Date**: 2026-04-08 | **Author**: Opus 4.6 | **Status**: Design doc for V8 implementation

---

## TL;DR

OpenRoom is ~70% of the way to being OpenClaw's native frontend — the chat panel already exposes the 5 main agents (`lacia/methode/kouka/snowdrop/satonus`) as LLM tools via `openclawAgentTools.ts`, and the mailbox is wired via `openclawMailboxTools.ts`. The remaining work is **visibility + ownership**, not a rewrite.

This doc specifies the redesign that makes each OpenRoom app feel like it is *owned by an OpenClaw agent* rather than a stand-alone toy with an optional chat bot on the side.

---

## 1. Current state (discovered, 2026-04-08)

### 1.1 What already exists ✅

| Component | Location | Evidence |
|-----------|----------|----------|
| **5 main agents as LLM tools** | `apps/webuiapps/src/lib/openclawAgentTools.ts` (215 lines) | `MAIN_AGENTS: MainAgentId[] = ['lacia', 'methode', 'kouka', 'snowdrop', 'satonus']`, `getOpenClawToolDefinitions()`, `executeOpenClawToolDetailed()` |
| **OpenClaw mailbox tools for LLM** | `apps/webuiapps/src/lib/openclawMailboxTools.ts` (172 lines) | `executeOpenClawMailboxTool`, `getOpenClawMailboxToolDefinitions` |
| **Mcp bridge tools** | `apps/webuiapps/src/lib/mcpBridgeTools.ts` | `executeMcpBridgeTool`, `loadMcpBridgeToolIndex` |
| **ChatPanel wired to all of the above** | `apps/webuiapps/src/components/ChatPanel/index.tsx` (2723 lines) | Imports `openclawAgentTools`, `openclawMailboxTools`, `mcpBridgeTools`, `fileTools`, `memoryManager`, `imageGenTools` |
| **Shell with Desktop + ChatPanel layout** | `apps/webuiapps/src/components/Shell/index.tsx` (523 lines) | Renders `<ChatPanel />` + `<AppWindow />`, uses `windowManager`, `appRegistry` |
| **11 apps with standard action pattern** | `apps/webuiapps/src/pages/{Album,Chess,CyberNews,Diary,Email,EvidenceVault,FreeCell,Gomoku,Home,MusicApp,Twitter}/` | All use `initVibeApp`, `useAgentActionListener`, `reportAction` |
| **APP_REGISTRY with 15 app defs** | `apps/webuiapps/src/lib/appRegistry.ts` (512 lines) | `getDesktopApps()`, `APP_REGISTRY`, `loadActionsFromMeta()` |
| **Action system (4 categories)** | `apps/webuiapps/src/lib/action.ts` (222 lines) | Operation / Mutation / Refresh / System, `CharacterAppAction`, `useAgentActionListener`, `reportAction` |
| **ClawRoom bridge plugin** | `.openclaw/extensions/openclaw-openroom-bridge/` (923 lines) | 15 registered tools for OpenClaw → OpenRoom |
| **ClawRoom integrations** | `ClawRoom/integrations/openroom-agentic-suite`, `ClawRoom/integrations/openroom-five-mainagent-router` | Five-main-agent router exists |

### 1.2 What is missing ❌

| Gap | Why it matters |
|-----|----------------|
| **No `owner_agent` field per app** — apps don't declare which main agent owns them | Chat doesn't know who to route app-specific requests to |
| **No per-app "ask my owner agent" button in app chrome** | User has to manually type "Hey Kouka, ..." in chat every time |
| **No Agent Hub view** — no single screen showing 5 agents × their apps × current status | Can't see the society at a glance |
| **Blog App doesn't exist** — V6 cron job `Blog-Maintenance-Kouka` has no frontend to drive | Kouka cron fires but nothing user-visible |
| **Chat panel doesn't visually indicate which agent is currently acting** | Feels like generic LLM, not a Beatless society |
| **No app↔agent activity indicator** (e.g., "Kouka is working on Blog…") | No ambient awareness of background work |
| **ClawRoom `openroom-agentic-suite` is a stub** | Integration boilerplate exists but not populated |

### 1.3 Architecture diagram (current)

```
┌──────────────────────────────────────────────────────────────┐
│                       OpenRoom (browser)                     │
│                                                              │
│  ┌─────────────────────┐       ┌────────────────────────┐    │
│  │   Desktop Shell     │       │      ChatPanel          │    │
│  │  (Shell/index.tsx)  │       │  (ChatPanel/index.tsx)  │    │
│  │                     │       │                          │    │
│  │  ┌───────────────┐  │       │  LLM client (chat)      │    │
│  │  │ AppWindow ×N  │  │       │      ↓                   │    │
│  │  │               │  │◄─────►│  Tool surface:           │    │
│  │  │ Diary  Music  │  │       │   - getAppActionTool    │    │
│  │  │ Twitter Chess │  │       │   - getFileTools        │    │
│  │  │ ...           │  │       │   - getMemoryTools      │    │
│  │  └───────────────┘  │       │   - getImageGenTools    │    │
│  │         ↑           │       │   - getOpenClawTools    │◄─┐ │
│  │         │           │       │   - getMcpBridgeTools   │  │ │
│  │   reportAction/     │       │   - getMailboxTools     │◄┐│ │
│  │   useAgentAction    │       │                          │││ │
│  │   Listener          │       │                          │││ │
│  └──────────┬──────────┘       └──────────────────────────┘││ │
│             │                                              ││ │
│             │   dispatchAgentAction / onUserAction         ││ │
│             └──────────────────────────────────────────────┘│ │
│                                                             │ │
└─────────────────────────────────────────────────────────────┘ │
                                                                │
                ┌───────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│                   OpenClaw Gateway (:18789)                  │
│                                                              │
│  openclaw-openroom-bridge plugin (923 lines, enabled)        │
│    tools: openroom_{health,dev_start,dev_stop,llm_*,session_*,│
│            characters_*,mods_*} (15 tools)                   │
│                                                              │
│  Heartbeat (30m) → 5 Beatless Agents                         │
│    Lacia / Methode / Satonus / Snowdrop / Kouka              │
│                                                              │
│  Cron scheduler (5 active jobs from V6)                      │
└─────────────────────────────────────────────────────────────┘
```

**Key insight**: Data flows bidirectionally today. OpenRoom→OpenClaw via `getOpenClawTools` and mailbox tools from ChatPanel; OpenClaw→OpenRoom via the 15 bridge tools + agent actions dispatched into `useAgentActionListener`. The plumbing is complete; only the **ownership metadata and UI affordances** are missing.

---

## 2. Design principles for V8 redesign

1. **Ownership over routing** — each app declares an `owner_agent`. Chat defaults to routing that app's questions to its owner. User can override.
2. **Visibility of the society** — agents are real citizens in the UI: avatars, status dots, activity indicators.
3. **Minimal rewrite** — do not rewrite the 2723-line ChatPanel. Surgical additions only (owner-agent badge, activity indicator row, agent hub drawer).
4. **Reuse existing tools** — `getOpenClawToolDefinitions` already routes to agents. We add the UI that invokes these tools with the correct `agent` param pre-filled.
5. **Decentralized** — Lacia is orchestrator but not ruler. Any agent can be called directly from any app via override.
6. **Evidence-based status** — don't fake "Kouka is typing…". Only show activity that corresponds to a real cron run, heartbeat turn, or user-triggered rc call.
7. **Design tokens strict** — every new component uses `--bg-*`, `--color-yellow`, `--spacing-*`. No hardcoded values.

---

## 3. Per-app agent owner mapping (V8 canonical table)

| app_id | App | Primary Agent | Rationale | Typical actions |
|:------:|-----|---------------|-----------|-----------------|
| 1 | MusicApp | **Kouka** | Delivery specialty; curates playlists as "delivery of the week" | CREATE_TRACK, PLAY_TRACK, CREATE_PLAYLIST |
| 2 | Twitter | **Kouka** | Delivery + public-facing, short-form content | CREATE_POST, LIKE_POST, COMMENT_POST |
| 3 | **Blog** (new) | **Kouka** | Long-form delivery; already wired to Blog-Maintenance cron | CREATE_POST, UPDATE_POST, PUBLISH_POST |
| 4 | Diary | **Lacia** | Lacia's role is symbiosis + trust + long-term relationship = personal journal fits her | CREATE_ENTRY, UPDATE_ENTRY |
| 5 | Home | **Lacia** | Home = orchestration dashboard; Lacia is orchestrator | (OS-level) |
| 6 | Chess | **Snowdrop** | Disruption + alternative-generation = game strategy | MAKE_MOVE, UNDO_MOVE |
| 7 | Gomoku | **Snowdrop** | Same — game + alternatives | MAKE_MOVE, UNDO_MOVE |
| 8 | Album | **Snowdrop** | Research/evidence-gathering = image archive | REFRESH (read-only) |
| 9 | FreeCell | **Snowdrop** | Puzzle/alternative-paths | MAKE_MOVE, NEW_GAME |
| 10 | EvidenceVault | **Satonus** | Review/audit/evidence = governance gate | UPLOAD_EVIDENCE, CLASSIFY, VERIFY |
| 11 | Email | **Satonus** | Compliance + governance = inbox review + audit trail | CREATE_DRAFT, SEND, FLAG |
| 12 | CyberNews | **Methode** | Implementation-heavy, news feed aggregation via GitHub/feeds | FETCH_NEWS, CATEGORIZE, REFRESH |
| 13 | MusicApp (if separate from 1) | — | See row 1 |

**Rationale pattern**: each agent's Beatless tendency (from `SOUL.md`) maps to app semantics:
- **Lacia** (symbiosis, convergence, narrative) → Diary, Home
- **Methode** (expansion, tooling, execution) → CyberNews (data aggregation)
- **Satonus** (governance, review, compliance) → EvidenceVault, Email
- **Snowdrop** (disruption, alternatives, research) → Chess, Gomoku, FreeCell, Album
- **Kouka** (delivery, stop-loss, competition) → MusicApp, Twitter, **Blog**

---

## 4. Implementation plan (phased)

### Phase A — Metadata layer (this session, low risk)

| Step | What | Files | Effort |
|:----:|------|-------|:------:|
| A.1 | Add `owner_agent: <id>` to every app's `meta.yaml` | 22 files (11 apps × {_en, _cn}) | small |
| A.2 | Add `owner_agent` to `AppDef` type in `appRegistry.ts` | 1 file | small |
| A.3 | Populate `APP_REGISTRY.owner_agent` from meta.yaml loader | `loadActionsFromMeta` in appRegistry.ts | small |
| A.4 | Scaffold new **Blog** app from Diary pattern | ~10 files | medium |

### Phase B — Visibility layer (next session)

| Step | What | Files | Effort |
|:----:|------|-------|:------:|
| B.1 | Add owner-agent badge to each app's title bar | `AppWindow` component | small |
| B.2 | Add "Call Kouka" quick-action button in app header (uses existing `executeOpenClawTool`) | `AppWindow` + new `AgentButton` component | medium |
| B.3 | Add agent-activity indicator row above ChatPanel input (non-rewrite — additive overlay) | `ChatPanel` minimal patch | medium |
| B.4 | Agent avatar assets (5 SVGs, design tokens colors) | new `assets/agents/` | small |

### Phase C — Agent Hub drawer (next session)

| Step | What | Files | Effort |
|:----:|------|-------|:------:|
| C.1 | New `AgentHub` component: grid view of 5 agents × their apps × last-run timestamp | new `components/AgentHub/` | medium |
| C.2 | Lacia cron job output → Agent Hub "last roundup" display | reads `runtime/meta-harness-reports/` or mailbox last entry | small |
| C.3 | Hot key (e.g., `⌘.`) to open Agent Hub from anywhere | `Shell` key listener | small |

### Phase D — Chat panel enhancements (future session, minimal rewrite)

**Non-goals**: do NOT rewrite the 2723-line ChatPanel. Surgical changes only.

| Step | What | Files | Effort |
|:----:|------|-------|:------:|
| D.1 | Auto-prefix chat messages with the owning agent when current window is an owned app | `ChatPanel` ~20 lines added | small |
| D.2 | Color chat bubbles by acting agent (yellow=Lacia, blue=Methode, red=Satonus, cyan=Snowdrop, purple=Kouka) | `ChatPanel` style patches | small |
| D.3 | Show "agent working" spinner when a main-agent tool call is in flight | `ChatPanel` state addition | small |

---

## 5. Blog App specification (Phase A.4)

### 5.1 File layout (mirrors Diary)

```
apps/webuiapps/src/pages/Blog/
├── actions/
│   └── constants.ts          # APP_ID=14, BlogActions
├── components/
│   └── PostEditor.tsx        # markdown editor (reuse Diary MarkdownEditor pattern)
├── blog_cn/
│   ├── meta.yaml             # owner_agent: kouka, CREATE_POST / UPDATE_POST / PUBLISH_POST / DELETE_POST
│   └── guide.md
├── blog_en/
│   ├── meta.yaml
│   └── guide.md
├── i18n/
│   ├── index.ts
│   ├── en.ts
│   └── zh.ts
├── index.tsx                 # entry — reportLifecycle, useAgentActionListener, createAppFileApi
├── index.module.scss
└── types.ts                  # Post interface
```

### 5.2 Data model (`types.ts`)

```typescript
export interface Post {
  id: string;            // e.g. "2026-04-08-blog-v6-ready"
  slug: string;          // URL-friendly
  title: string;
  content: string;       // markdown body
  excerpt?: string;      // first 160 chars if not set
  author: string;        // defaults to agent id: "kouka"
  createdAt: string;     // ISO
  updatedAt: string;
  publishedAt?: string;  // set when PUBLISH_POST fires
  status: 'draft' | 'published' | 'archived';
  tags: string[];
  heroImageUrl?: string; // from Minimax image-01
  audioUrl?: string;     // from Minimax speech-2.8-hd TTS
  sourceAgent: 'kouka';  // provenance: which agent authored
  tokenCost?: number;    // optional telemetry
}

export interface BlogState {
  currentPostId?: string;
  filter: 'all' | 'draft' | 'published' | 'archived';
  sortBy: 'createdAt' | 'updatedAt' | 'publishedAt';
}
```

### 5.3 Actions (agent → frontend dispatches)

| Action | Category | Params | Purpose |
|--------|----------|--------|---------|
| `CREATE_POST` | Mutation | `filePath` | Kouka wrote `/posts/{id}.json`, frontend refreshes |
| `UPDATE_POST` | Mutation | `filePath` | Kouka updated an existing post |
| `DELETE_POST` | Mutation | `postId` | Kouka deleted a post |
| `PUBLISH_POST` | Operation | `postId` | Transitions status draft→published, updates `publishedAt` |
| `REFRESH_POSTS` | Refresh | — | Reload `/posts/` directory |
| `SELECT_POST` | Navigation | `postId` | Frontend navigates to a specific post |
| `SYNC_STATE` | System | — | Reads `/state.json` to resync filter/currentPost |

### 5.4 Owner agent integration

- `owner_agent: kouka` declared in both `blog_en/meta.yaml` and `blog_cn/meta.yaml`
- Blog-Maintenance-Kouka cron (V6) continues to fire Tue/Fri 10:00 and calls `/gsd-do draft blog post...`
- New "Ask Kouka to generate" button in Blog header (Phase B.2)

### 5.5 File paths (via createAppFileApi)

```
apps/blog/data/posts/<post-id>.json         # one JSON per post
apps/blog/data/posts/<post-id>.md           # rendered markdown (optional cache)
apps/blog/data/assets/<post-id>-hero.png    # Minimax image output
apps/blog/data/assets/<post-id>-audio.mp3   # Minimax TTS output
apps/blog/data/state.json                   # BlogState
```

---

## 6. Agent Hub view design (Phase C — sketch only, no code this session)

### 6.1 Layout

```
┌──────────────────── Agent Hub ────────────────────────┐
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  Lacia   │  │ Methode  │  │ Satonus  │            │
│  │ ●online  │  │ ●online  │  │ ●online  │            │
│  │          │  │          │  │          │            │
│  │ Diary    │  │ CyberNews│  │ Email    │            │
│  │ Home     │  │          │  │ Evidence │            │
│  │          │  │          │  │ Vault    │            │
│  │ Last:    │  │ Last:    │  │ Last:    │            │
│  │ 09:20    │  │ 16:00    │  │ 15:15    │            │
│  │ daily    │  │ PR cycle │  │ CI guard │            │
│  │ report   │  │          │  │          │            │
│  │          │  │          │  │          │            │
│  │ [view]   │  │ [view]   │  │ [view]   │            │
│  └──────────┘  └──────────┘  └──────────┘            │
│                                                        │
│  ┌──────────┐  ┌──────────┐                            │
│  │ Snowdrop │  │  Kouka   │                            │
│  │ ●online  │  │ ●online  │                            │
│  │          │  │          │                            │
│  │ Chess    │  │ Blog     │                            │
│  │ Gomoku   │  │ MusicApp │                            │
│  │ Album    │  │ Twitter  │                            │
│  │ FreeCell │  │          │                            │
│  │          │  │          │                            │
│  │ Last:    │  │ Last:    │                            │
│  │ 10:40    │  │ (idle)   │                            │
│  │ github   │  │          │                            │
│  │ explore  │  │          │                            │
│  │          │  │          │                            │
│  │ [view]   │  │ [view]   │                            │
│  └──────────┘  └──────────┘                            │
│                                                        │
│  [ Dispatch to all agents ]  [ View cron schedule ]    │
└────────────────────────────────────────────────────────┘
```

### 6.2 Data sources (all local, no new backend)

| Field | Source |
|-------|--------|
| Agent name, specialty | hardcoded constants (matches `MAIN_AGENTS`) |
| `●online` status | query `./openclaw-local gateway status` via bridge tool |
| Owned apps | `APP_REGISTRY.filter(a => a.owner_agent === id)` |
| Last run timestamp | `./openclaw-local cron runs --agent <id>` via new bridge tool OR read `.openclaw/logs/metrics.csv` |
| Last action description | cron job name + last status |
| `[view]` button | opens the agent's most recent session log or dispatches a `/gsd-session-report` rc call |

### 6.3 Keyboard shortcut

`⌘. / Ctrl+.` opens Agent Hub drawer from any context.

---

## 7. Chat panel enhancements (Phase D — future, minimal)

**Additive only** — no rewrite of the 2723-line component.

### 7.1 Owning-agent prefix (D.1)

When the user sends a message AND the currently-focused window belongs to an owned app, auto-prefix:
```
[→ kouka, context: Blog/2026-04-08-v6-ready]
<user's actual message>
```
This is a system-prompt augmentation the LLM sees but the user sees as a faint chip above the input.

### 7.2 Agent color coding (D.2)

Message bubbles in ChatPanel colored by acting agent:

| Agent | Bubble accent | Rationale |
|-------|---------------|-----------|
| Lacia | `--color-yellow` (`#FAEA5F`) | symbiosis, warmth |
| Methode | `--color-cyan` (`#2EA7FF`) | precision, building |
| Satonus | `--color-red` (`#FF3F4D`) | governance, gate |
| Snowdrop | `--color-purple` (`#7660FF`) | disruption, alternatives |
| Kouka | `--color-yellow-light` (`#FFFDBB`) | delivery, shipping |

Use existing design tokens — no new colors added.

### 7.3 Activity indicator (D.3)

Thin row above ChatPanel input:
```
● lacia idle   ● methode idle   ● satonus idle   ● snowdrop working (10s)   ● kouka idle
```
Updates from `executeOpenClawToolDetailed` in-flight state.

---

## 8. Non-goals (explicitly out of scope)

1. **Rewriting ChatPanel from scratch** — too high-risk, too large, and unnecessary given the existing integration
2. **Building a new message bus** — file-based + existing mailbox is sufficient for V8
3. **Rewriting the `openroom-bridge` plugin** — it already has 15 tools and works
4. **Custom LLM client** — `llmClient.ts` stays as-is
5. **Removing characters/mods panels** — they're orthogonal; keep
6. **Replacing `windowManager`** — keep as-is

---

## 9. Security & safety notes

1. **Owner agent is a preference, not a permission** — per peer-model design (V5), any agent can still execute any task. Owner is the default route, not a lock.
2. **No auto-execute** — Phase B.2 "Call Kouka" button requires explicit user click. No autonomous app→agent dispatch without user consent.
3. **Bridge tools remain gateway-authenticated** — no new unauthenticated paths
4. **Design tokens strict** — no hardcoded colors that might bleed agent branding into user-content areas

---

## 10. Implementation progress (this session)

| Phase | Status |
|:-----:|:------:|
| A.1 Add `owner_agent` to meta.yaml × 22 files | ⏭️ not this session — scope |
| A.2 Add `owner_agent` to AppDef type | ⏭️ not this session |
| A.3 Populate from meta loader | ⏭️ not this session |
| **A.4 Blog app scaffold** | 🟢 in progress this session |
| B.* Visibility layer | ⏭️ next session |
| C.* Agent Hub | ⏭️ next session |
| D.* ChatPanel enhancements | ⏭️ future session |

**This session's concrete deliverable**: the new Blog App (Phase A.4), plus this design doc. Phase A.1-A.3 could be done later in the session if time permits; everything else is documented for subsequent sessions.

---

## 11. Verification plan

After each phase:
1. `cd OpenRoom/apps/webuiapps && pnpm run lint` — ESLint clean
2. `pnpm build` — Turborepo build green
3. `pnpm test` — Vitest unit tests
4. `pnpm test:e2e` — Playwright E2E for affected flows
5. Manual: bring up dev server, open new app, verify lifecycle reports READY

For the Blog App specifically:
- Blog window opens from desktop
- Create a post via a mock `reportAction(CREATE_POST, {filePath: '/posts/test.json'})` → verify post appears
- Call `/gsd-do draft blog post about V6` via ChatPanel → verify Kouka generates content → verify post appears

---

## 12. Rollback

If Blog App scaffold breaks build:
```bash
cd OpenRoom/apps/webuiapps
rm -rf src/pages/Blog
git checkout -- src/lib/appRegistry.ts src/lib/seedMeta.ts
pnpm build
```

If design doc itself needs revision — it's a markdown file, just edit.

---

*V8 OpenRoom Agentic Redesign — minimal rewrite, maximum visibility. The infrastructure is already there; we're adding the ownership, the affordances, and the society that makes it feel alive.*
