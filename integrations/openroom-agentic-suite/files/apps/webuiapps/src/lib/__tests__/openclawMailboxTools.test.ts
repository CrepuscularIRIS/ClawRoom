import { describe, expect, it } from 'vitest';
import { getOpenClawMailboxToolDefinitions, isOpenClawMailboxTool } from '../openclawMailboxTools';

describe('openclawMailboxTools', () => {
  it('exposes mailbox tool names', () => {
    const names = getOpenClawMailboxToolDefinitions().map((d) => d.function.name);
    expect(names).toEqual([
      'openclaw_mailbox_send',
      'openclaw_mailbox_poll',
      'openclaw_mailbox_ack',
    ]);
  });

  it('matches only mailbox tools', () => {
    expect(isOpenClawMailboxTool('openclaw_mailbox_send')).toBe(true);
    expect(isOpenClawMailboxTool('openclaw_mailbox_poll')).toBe(true);
    expect(isOpenClawMailboxTool('openclaw_mailbox_ack')).toBe(true);
    expect(isOpenClawMailboxTool('delegate_to_main_agent')).toBe(false);
  });
});
