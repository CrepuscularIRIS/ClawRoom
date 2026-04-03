import type { ToolDef } from './llmClient';

export interface OpenClawMailboxMessage {
  id: string;
  from: string;
  to: string;
  subject?: string;
  body: string;
  threadId?: string;
  createdAt: number;
  ackedBy?: string[];
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getOpenClawMailboxToolDefinitions(): ToolDef[] {
  return [
    {
      type: 'function',
      function: {
        name: 'openclaw_mailbox_send',
        description: 'Send a mailbox message between OpenClaw main agents.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Sender agent id' },
            to: { type: 'string', description: 'Target agent id' },
            subject: { type: 'string', description: 'Short subject line' },
            body: { type: 'string', description: 'Message body' },
            thread_id: { type: 'string', description: 'Optional thread id' },
          },
          required: ['from', 'to', 'body'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'openclaw_mailbox_poll',
        description: 'Poll mailbox messages for one OpenClaw main agent.',
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Agent id to poll' },
            limit: { type: 'number', description: 'Max number of messages to fetch (default 10)' },
            include_acked: {
              type: 'boolean',
              description: 'Whether to include already acknowledged messages',
            },
          },
          required: ['agent'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'openclaw_mailbox_ack',
        description: 'Acknowledge mailbox messages for one OpenClaw main agent.',
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Agent id acknowledging messages' },
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Message ids to acknowledge',
            },
          },
          required: ['agent', 'message_ids'],
        },
      },
    },
  ];
}

export function isOpenClawMailboxTool(toolName: string): boolean {
  return (
    toolName === 'openclaw_mailbox_send' ||
    toolName === 'openclaw_mailbox_poll' ||
    toolName === 'openclaw_mailbox_ack'
  );
}

async function postMailbox(body: Record<string, unknown>): Promise<string> {
  const res = await fetch('/api/openclaw-mailbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = safeParseJson<{ ok?: boolean; error?: string } & Record<string, unknown>>(text, {});
  if (!res.ok || !data.ok) {
    return `error: ${data.error || text || `HTTP ${res.status}`}`;
  }
  return JSON.stringify(data, null, 2);
}

async function pollMailbox(params: Record<string, unknown>): Promise<string> {
  const agent = String(params.agent || '').trim();
  if (!agent) return 'error: missing agent';

  const limitRaw = Number(params.limit || 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 10;
  const includeAcked = params.include_acked === true;

  const query = new URLSearchParams({
    action: 'poll',
    agent,
    limit: String(limit),
    includeAcked: includeAcked ? '1' : '0',
  });

  const res = await fetch(`/api/openclaw-mailbox?${query.toString()}`);
  const text = await res.text();
  const data = safeParseJson<{ ok?: boolean; error?: string } & Record<string, unknown>>(text, {});
  if (!res.ok || !data.ok) {
    return `error: ${data.error || text || `HTTP ${res.status}`}`;
  }
  return JSON.stringify(data, null, 2);
}

export async function executeOpenClawMailboxTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<string> {
  if (toolName === 'openclaw_mailbox_poll') {
    return pollMailbox(params);
  }

  if (toolName === 'openclaw_mailbox_send') {
    const from = String(params.from || '').trim();
    const to = String(params.to || '').trim();
    const body = String(params.body || '').trim();
    if (!from || !to || !body) {
      return 'error: from/to/body are required';
    }

    return postMailbox({
      action: 'send',
      from,
      to,
      subject: String(params.subject || '').trim(),
      body,
      threadId: String(params.thread_id || '').trim(),
    });
  }

  if (toolName === 'openclaw_mailbox_ack') {
    const agent = String(params.agent || '').trim();
    const ids = Array.isArray(params.message_ids)
      ? params.message_ids.map((v) => String(v).trim()).filter(Boolean)
      : [];
    if (!agent || ids.length === 0) {
      return 'error: agent and non-empty message_ids are required';
    }

    return postMailbox({
      action: 'ack',
      agent,
      messageIds: ids,
    });
  }

  return `error: unsupported mailbox tool ${toolName}`;
}
