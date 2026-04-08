#!/usr/bin/env node
/**
 * ClawRoom Beatless Adapter — REST + SSE API Server
 *
 * Exposes the Beatless Adapter via HTTP so any frontend (OpenRoom, CLI, external
 * webhooks) can query agent state and receive event streams.
 *
 * Zero external deps — uses built-in `node:http` only. This keeps the ClawRoom
 * adapter deployable without any npm install step.
 *
 * Endpoints:
 *   GET  /api/health                     — adapter + gateway health
 *   GET  /api/agents                     — list all 5 agents with current state
 *   GET  /api/agents/:id/state           — full state for one agent
 *   GET  /api/events                     — SSE stream of state changes (polls every 10s)
 *   POST /api/tasks                      — submit a task envelope to an agent (stub)
 *
 * Start: node ClawRoom/src/api/server.mjs [--port=17890] [--host=127.0.0.1]
 */

import { createServer } from 'node:http';
import { URL } from 'node:url';
import {
  MAIN_AGENTS,
  collectAgentState,
  collectAllAgentStates,
  probeGatewayHealth,
  getOpenClawRoot,
} from '../adapter/beatlessAdapter.mjs';

// ============================================================================
// Argument parsing
// ============================================================================

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const flag = args.find((a) => a.startsWith(`--${name}=`));
  if (flag) return flag.slice(name.length + 3);
  const envName = `CLAWROOM_${name.toUpperCase().replace(/-/g, '_')}`;
  return process.env[envName] || fallback;
}

const PORT = parseInt(getArg('port', '17890'), 10);
const HOST = getArg('host', '127.0.0.1');
const SSE_INTERVAL_MS = parseInt(getArg('sse-interval-ms', '10000'), 10);
const AUTH_TOKEN = getArg('auth-token', process.env.CLAWROOM_AUTH_TOKEN || '');

// ============================================================================
// Helpers
// ============================================================================

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(payload);
}

function errorResponse(res, status, message, code) {
  jsonResponse(res, status, {
    error: {
      code: code || 'error',
      message,
      status,
    },
  });
}

function checkAuth(req) {
  if (!AUTH_TOKEN) return true; // no auth configured → open mode for local dev
  const header = req.headers['authorization'] || '';
  const token = header.replace(/^Bearer\s+/i, '');
  return token === AUTH_TOKEN;
}

async function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ============================================================================
// Route handlers
// ============================================================================

async function handleHealth(req, res) {
  const root = getOpenClawRoot();
  const gateway = await probeGatewayHealth(root);
  jsonResponse(res, 200, {
    adapter: { ok: true, version: '0.1.0' },
    gateway,
    clawroom: {
      root,
      port: PORT,
      host: HOST,
      authEnabled: Boolean(AUTH_TOKEN),
    },
    collectedAtMs: Date.now(),
  });
}

async function handleAgentsList(req, res) {
  try {
    const snapshot = await collectAllAgentStates();
    jsonResponse(res, 200, snapshot);
  } catch (err) {
    errorResponse(res, 500, err.message || 'failed to collect agent states', 'collect_failed');
  }
}

async function handleAgentState(req, res, agentId) {
  if (!MAIN_AGENTS.includes(agentId)) {
    errorResponse(res, 404, `unknown agent: ${agentId}`, 'agent_not_found');
    return;
  }
  try {
    const state = await collectAgentState(agentId);
    jsonResponse(res, 200, state);
  } catch (err) {
    errorResponse(res, 500, err.message || 'failed to collect state', 'collect_failed');
  }
}

/**
 * SSE endpoint — emits a `snapshot` event every SSE_INTERVAL_MS with full
 * agent state, plus one-off events for any state change observed between
 * polls. This is a polling-driven MVP; a future version will wire directly
 * to the gateway event bus for true push semantics.
 */
function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(': clawroom event stream connected\n\n');

  let closed = false;
  let lastSnapshotJson = '';

  const tick = async () => {
    if (closed) return;
    try {
      const snapshot = await collectAllAgentStates();
      const snapshotJson = JSON.stringify(snapshot);
      if (snapshotJson !== lastSnapshotJson) {
        res.write(`event: snapshot\n`);
        res.write(`data: ${snapshotJson}\n\n`);
        lastSnapshotJson = snapshotJson;
      } else {
        // still send a heartbeat so clients don't timeout
        res.write(`event: heartbeat\n`);
        res.write(`data: ${JSON.stringify({ at: Date.now() })}\n\n`);
      }
    } catch (err) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: err.message })}\n\n`);
    }
  };

  // Immediate first tick
  void tick();
  const timer = setInterval(tick, SSE_INTERVAL_MS);

  req.on('close', () => {
    closed = true;
    clearInterval(timer);
  });
}

/**
 * Task submission — MVP stub.
 *
 * Accepts `{ agent, taskType, payload, priority, callbackUrl }` and records
 * the envelope to a local file-based mailbox drop. Does NOT yet invoke the
 * agent directly — that requires the full mailbox bus (Architect.md future
 * work). For now the task envelope is written where the cron/heartbeat
 * pipeline can pick it up.
 */
async function handleTaskSubmit(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    errorResponse(res, 400, `invalid json: ${err.message}`, 'bad_request');
    return;
  }
  if (!body || typeof body !== 'object') {
    errorResponse(res, 400, 'request body required', 'bad_request');
    return;
  }
  const { agent, taskType, payload, priority = 'normal', callbackUrl } = body;
  if (!MAIN_AGENTS.includes(agent)) {
    errorResponse(res, 400, `unknown agent: ${agent}`, 'agent_not_found');
    return;
  }
  if (!taskType || typeof taskType !== 'string') {
    errorResponse(res, 400, 'taskType required (string)', 'bad_request');
    return;
  }

  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const envelope = {
    taskId,
    agent,
    taskType,
    payload: payload ?? {},
    priority,
    callbackUrl,
    submittedAtMs: Date.now(),
    status: 'queued',
    source: 'clawroom-api',
  };

  // MVP: echo back the envelope. Persistence to a real mailbox bus is
  // Architect.md P4-9 (real 8-type mailbox). For now consumers can read
  // this envelope from the API response and forward it manually.
  jsonResponse(res, 202, {
    accepted: true,
    task: envelope,
    note:
      'MVP stub — task envelope not yet dispatched to agent. Real mailbox bus is architectural work (see Architect.md §Mailbox).',
  });
}

// ============================================================================
// Router
// ============================================================================

async function router(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  // Public health endpoint (no auth)
  if (req.method === 'GET' && pathname === '/api/health') {
    await handleHealth(req, res);
    return;
  }

  // All other endpoints require auth (if configured)
  if (!checkAuth(req)) {
    errorResponse(res, 401, 'invalid or missing Authorization', 'unauthorized');
    return;
  }

  if (req.method === 'GET' && pathname === '/api/agents') {
    await handleAgentsList(req, res);
    return;
  }

  const stateMatch = pathname.match(/^\/api\/agents\/([^/]+)\/state$/);
  if (req.method === 'GET' && stateMatch) {
    await handleAgentState(req, res, stateMatch[1]);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    handleEvents(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tasks') {
    await handleTaskSubmit(req, res);
    return;
  }

  errorResponse(res, 404, `no route for ${req.method} ${pathname}`, 'not_found');
}

// ============================================================================
// Bootstrap
// ============================================================================

const server = createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (err) {
    console.error('[clawroom-api] unhandled error', err);
    if (!res.headersSent) {
      errorResponse(res, 500, 'internal error', 'internal');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.error(
    `[clawroom-api] listening on http://${HOST}:${PORT}  (auth=${AUTH_TOKEN ? 'enabled' : 'off'}, sse=${SSE_INTERVAL_MS}ms)`,
  );
});

// Graceful shutdown
const shutdown = (signal) => {
  console.error(`[clawroom-api] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
