/**
 * ClawRoom Beatless Adapter
 *
 * Pure-Node runtime adapter that reads OpenClaw state and exposes it as a
 * uniform `AgentState` structure for any consumer (OpenRoom UI, CLI, API,
 * webhooks). The adapter NEVER writes directly to OpenClaw state — write
 * operations go through `./openclaw-local` CLI or the gateway RPC bridge.
 *
 * Design goals:
 * 1. Zero dependency on gateway HTTP (gateway is WebSocket, not REST)
 * 2. Read-only by default — mutations are explicit rc calls
 * 3. Defensive — partial state is better than error
 * 4. Fast — all reads are local FS + cheap CLI probes
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// ============================================================================
// Canonical constants — source of truth for the 5 Beatless agents
// ============================================================================

/** The 5 Beatless main agents in canonical order (orchestrator first). */
export const MAIN_AGENTS = /** @type {const} */ ([
  'lacia',
  'methode',
  'satonus',
  'snowdrop',
  'kouka',
]);

/** @typedef {'lacia'|'methode'|'satonus'|'snowdrop'|'kouka'} MainAgentId */

/**
 * Beatless specialty tendencies — derived from each agent's SOUL.md.
 * Used for human-readable reporting and UI tooltips.
 */
export const AGENT_TENDENCIES = {
  lacia: 'Symbiosis & trust — orchestrator, convergence authority',
  methode: 'Expansion & tooling — executor, artifact ownership',
  satonus: 'Environment & rule governance — review gate, veto power',
  snowdrop: 'Disruption & alternative generation — researcher, scorer',
  kouka: 'Competition & pressure decision — delivery, stop-loss',
};

// ============================================================================
// OpenClaw root resolution
// ============================================================================

/**
 * Resolve the OpenClaw root directory. Defaults to the repo root derived
 * from this file's location; overridable via OPENCLAW_HOME env var.
 */
export function getOpenClawRoot() {
  if (process.env.OPENCLAW_HOME) return process.env.OPENCLAW_HOME;
  // this file lives at ClawRoom/src/adapter/beatlessAdapter.mjs
  // repo root is 3 levels up
  const here = new URL('.', import.meta.url).pathname;
  return path.resolve(here, '..', '..', '..');
}

// ============================================================================
// Low-level probes — each reads one piece of state
// ============================================================================

/**
 * Run `openclaw-local cron list --json` and parse the result.
 * Returns [] on any failure — the caller handles the degraded state.
 */
export async function probeCronJobs(root) {
  try {
    const { stdout } = await execFileAsync(path.join(root, 'openclaw-local'), [
      'cron',
      'list',
      '--json',
    ], { cwd: root, timeout: 15000 });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.jobs)) return parsed.jobs;
    return [];
  } catch {
    // fallback: read jobs.json directly if CLI fails
    try {
      const file = path.join(root, '.openclaw', 'cron', 'jobs.json');
      const text = await readFile(file, 'utf8');
      const parsed = JSON.parse(text);
      return Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    } catch {
      return [];
    }
  }
}

/**
 * Read session store for a specific agent.
 * Returns the last N session records (defaults to 5) sorted by last activity.
 */
export async function probeAgentSessions(root, agentId, limit = 5) {
  const file = path.join(root, '.openclaw', 'agents', agentId, 'sessions', 'sessions.json');
  try {
    const text = await readFile(file, 'utf8');
    const parsed = JSON.parse(text);
    // sessions.json structure varies — defensive extraction
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.sessions)
        ? parsed.sessions
        : Array.isArray(parsed?.entries)
          ? parsed.entries
          : [];
    return entries
      .slice()
      .sort((a, b) => {
        const aTs = typeof a?.updatedAt === 'number' ? a.updatedAt : typeof a?.lastActiveMs === 'number' ? a.lastActiveMs : 0;
        const bTs = typeof b?.updatedAt === 'number' ? b.updatedAt : typeof b?.lastActiveMs === 'number' ? b.lastActiveMs : 0;
        return bTs - aTs;
      })
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Get the agent's memory database file info (mtime, size) — proxy for
 * "when did this agent last think".
 */
export async function probeAgentMemory(root, agentId) {
  const file = path.join(root, '.openclaw', 'memory', `${agentId}.sqlite`);
  try {
    const st = await stat(file);
    return {
      path: file,
      sizeBytes: st.size,
      lastModifiedMs: st.mtimeMs,
    };
  } catch {
    return null;
  }
}

/**
 * Probe the gateway RPC endpoint via the CLI. Returns `{ ok, lastCheckedMs }`.
 */
export async function probeGatewayHealth(root) {
  try {
    const { stdout } = await execFileAsync(path.join(root, 'openclaw-local'), [
      'gateway',
      'status',
    ], { cwd: root, timeout: 10000 });
    const ok = /RPC probe:\s*ok/.test(stdout);
    return { ok, lastCheckedMs: Date.now() };
  } catch {
    return { ok: false, lastCheckedMs: Date.now() };
  }
}

/**
 * Probe workspace-level lifecycle files (HEARTBEAT.md, SOUL.md mtime) —
 * proxy for "when was this agent last reconfigured".
 */
export async function probeAgentWorkspace(root, agentId) {
  const dir = path.join(root, '.openclaw', `workspace-${agentId}`);
  try {
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    const stats = await Promise.all(
      mdFiles.map(async (f) => {
        try {
          const st = await stat(path.join(dir, f));
          return { name: f, lastModifiedMs: st.mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    return stats.filter(Boolean);
  } catch {
    return [];
  }
}

// ============================================================================
// High-level state assembly
// ============================================================================

/**
 * @typedef {object} AgentState
 * @property {MainAgentId} agent
 * @property {string} displayName
 * @property {string} tendency
 * @property {'online'|'offline'|'unknown'} status
 * @property {'idle'|'working'|'blocked'|'unknown'} activity
 * @property {number|null} lastActivityMs
 * @property {Array<object>} cronJobs
 * @property {object|null} nextCronRun
 * @property {Array<object>} recentSessions
 * @property {object|null} memory
 * @property {Array<object>} workspaceFiles
 */

/**
 * Collect the full state of a single Beatless agent.
 *
 * Reads cron, sessions, memory, and workspace state in parallel.
 * Degraded behavior: any missing piece is reported as `null` or `[]`.
 */
export async function collectAgentState(agentId, opts = {}) {
  const root = opts.root || getOpenClawRoot();
  if (!MAIN_AGENTS.includes(agentId)) {
    throw new Error(`unknown agent: ${agentId}`);
  }

  // Parallel probes — fail-soft
  const [cronJobs, sessions, memory, workspaceFiles] = await Promise.all([
    opts.cronJobs ? Promise.resolve(opts.cronJobs) : probeCronJobs(root),
    probeAgentSessions(root, agentId, opts.sessionLimit || 5),
    probeAgentMemory(root, agentId),
    probeAgentWorkspace(root, agentId),
  ]);

  // Filter cron jobs belonging to this agent
  const agentCron = cronJobs.filter(
    (job) => job && (job.agentId === agentId || job.agent === agentId),
  );

  // Find the next scheduled run (smallest nextRunAtMs in the future)
  const now = Date.now();
  const futureRuns = agentCron
    .map((j) => j?.state?.nextRunAtMs || j?.nextRunAtMs || null)
    .filter((ms) => typeof ms === 'number' && ms > now)
    .sort((a, b) => a - b);
  const nextCronRun = futureRuns.length
    ? { at: new Date(futureRuns[0]).toISOString(), ms: futureRuns[0] }
    : null;

  // Last activity: max of memory mtime, session timestamps, workspace mtime
  const memoryMs = memory?.lastModifiedMs || 0;
  const sessionMs = sessions[0]?.updatedAt || sessions[0]?.lastActiveMs || 0;
  const workspaceMs = workspaceFiles.reduce((max, f) => Math.max(max, f.lastModifiedMs || 0), 0);
  const lastActivityMs = Math.max(memoryMs, sessionMs, workspaceMs) || null;

  // Activity heuristic: if within last 5 min → working, 1h → idle, else unknown
  let activity = 'unknown';
  if (lastActivityMs) {
    const age = now - lastActivityMs;
    if (age < 5 * 60 * 1000) activity = 'working';
    else if (age < 60 * 60 * 1000) activity = 'idle';
    else activity = 'idle';
  }

  // Status: gateway-dependent (passed in) or assume online if recent activity
  const status = opts.gatewayOnline === undefined
    ? (lastActivityMs ? 'online' : 'unknown')
    : opts.gatewayOnline ? 'online' : 'offline';

  return {
    agent: agentId,
    displayName: agentId.charAt(0).toUpperCase() + agentId.slice(1),
    tendency: AGENT_TENDENCIES[agentId],
    status,
    activity,
    lastActivityMs,
    cronJobs: agentCron,
    nextCronRun,
    recentSessions: sessions,
    memory,
    workspaceFiles,
  };
}

/**
 * Collect state for all 5 Beatless agents in parallel.
 * Also probes gateway health once and propagates to each agent state.
 */
export async function collectAllAgentStates(opts = {}) {
  const root = opts.root || getOpenClawRoot();

  // Probe shared state once
  const [cronJobs, gateway] = await Promise.all([
    probeCronJobs(root),
    probeGatewayHealth(root),
  ]);

  const states = await Promise.all(
    MAIN_AGENTS.map((id) =>
      collectAgentState(id, {
        root,
        cronJobs,
        gatewayOnline: gateway.ok,
        sessionLimit: opts.sessionLimit,
      }),
    ),
  );

  return {
    gateway,
    agents: states,
    collectedAtMs: Date.now(),
  };
}
