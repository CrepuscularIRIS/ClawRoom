import type { ToolDef } from './llmClient';

export type MainAgentId = 'lacia' | 'methode' | 'kouka' | 'snowdrop' | 'satonus';

interface OpenClawAgentResponse {
  ok: boolean;
  agent?: MainAgentId;
  sessionId?: string;
  text?: string;
  runId?: string | null;
  status?: string | null;
  summary?: string | null;
  error?: string;
}

const TOOL_NAME = 'delegate_to_main_agent';
export const MAIN_AGENTS: MainAgentId[] = ['lacia', 'methode', 'kouka', 'snowdrop', 'satonus'];
const OPENCLAW_AGENT_ENDPOINT = '/api/openclaw-agent';
const OPENCLAW_FETCH_TIMEOUT_MS = 180_000;
const OPENCLAW_FETCH_RETRIES = 2;

export interface OpenClawDelegateResult {
  ok: boolean;
  agent?: MainAgentId;
  sessionId?: string;
  text?: string;
  runId?: string | null;
  status?: string | null;
  summary?: string | null;
  error?: string;
}

export function getOpenClawToolDefinitions(): ToolDef[] {
  return [
    {
      type: 'function',
      function: {
        name: TOOL_NAME,
        description:
          'Delegate a complex task to one of 5 OpenClaw main agents. ' +
          'Use for architecture, coding, review, research, or security checks. ' +
          'Roles: lacia=orchestrator, methode=builder, kouka=delivery/content, snowdrop=research, satonus=security.',
        parameters: {
          type: 'object',
          properties: {
            agent: {
              type: 'string',
              enum: [...MAIN_AGENTS],
              description: 'Target OpenClaw main agent',
            },
            task: {
              type: 'string',
              description: 'Task prompt sent to the target agent',
            },
            session_id: {
              type: 'string',
              description: 'Optional fixed session id for continuity',
            },
          },
          required: ['agent', 'task'],
        },
      },
    },
  ];
}

export function isOpenClawTool(toolName: string): boolean {
  return toolName === TOOL_NAME;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postOpenClawAgent(
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= OPENCLAW_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), OPENCLAW_FETCH_TIMEOUT_MS);
    try {
      return await fetch(OPENCLAW_AGENT_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      lastError = err;
      if (attempt < OPENCLAW_FETCH_RETRIES) {
        await wait(400 * attempt);
        continue;
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'fetch failed'));
}

export async function executeOpenClawToolDetailed(
  params: Record<string, unknown>,
): Promise<OpenClawDelegateResult> {
  const agent = String(params.agent || '').trim().toLowerCase();
  const task = String(params.task || '').trim();
  const sessionIdRaw = params.session_id;
  const sessionId =
    typeof sessionIdRaw === 'string' && sessionIdRaw.trim() ? sessionIdRaw.trim() : undefined;

  if (!agent) {
    return { ok: false, error: 'missing agent' };
  }

  if (!MAIN_AGENTS.includes(agent as MainAgentId)) {
    return { ok: false, error: `invalid agent "${agent}"` };
  }

  const targetAgent = agent as MainAgentId;

  if (!task) {
    return { ok: false, agent: targetAgent, error: 'missing task' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  try {
    const token = localStorage.getItem('openroom-openclaw-bridge-token') || '';
    if (token.trim()) {
      headers['x-openclaw-bridge-token'] = token.trim();
    }
  } catch {
    // ignore storage errors
  }

  let res: Response;
  try {
    res = await postOpenClawAgent(
      {
        agent,
        message: task,
        ...(sessionId ? { sessionId } : {}),
      },
      headers,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err || 'Failed to fetch');
    return {
      ok: false,
      agent: targetAgent,
      error: `openclaw bridge fetch failed: ${msg}. 请检查 OpenRoom 服务是否在线，并确认 /api/openclaw-agent 可访问。`,
    };
  }

  const raw = await res.text();
  let data: OpenClawAgentResponse | null = null;
  try {
    data = JSON.parse(raw) as OpenClawAgentResponse;
  } catch {
    data = null;
  }

  if (!res.ok || !data?.ok) {
    const errorText = data?.error || raw || `HTTP ${res.status}`;
    return { ok: false, agent: targetAgent, error: errorText };
  }

  const answer = (data.text || '').trim();
  if (!answer) {
    return { ok: false, agent: targetAgent, error: 'empty response from OpenClaw agent' };
  }

  return {
    ok: true,
    agent: targetAgent,
    sessionId: data.sessionId,
    text: answer,
    runId: data.runId ?? null,
    status: data.status ?? null,
    summary: data.summary ?? null,
  };
}

export async function executeOpenClawTool(
  params: Record<string, unknown>,
): Promise<string> {
  const result = await executeOpenClawToolDetailed(params);
  if (!result.ok) {
    return `error: ${result.error || 'openclaw delegate failed'}`;
  }
  return result.text || 'error: empty response from OpenClaw agent';
}
