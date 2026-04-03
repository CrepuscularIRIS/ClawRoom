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

  const res = await fetch('/api/openclaw-agent', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent,
      message: task,
      ...(sessionId ? { sessionId } : {}),
    }),
  });

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
