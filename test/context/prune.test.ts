import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/types/message.js';
import {
  DEFAULT_TAIL_TURNS,
  PRUNE_MINIMUM,
  PRUNE_PROTECT,
  pruneToolOutputs,
} from '../../src/context/prune.js';

function userMsg(seq: number, text = 'go'): Message {
  return { role: 'user', seq, content: [{ type: 'text', text }] };
}

function toolUseMsg(seq: number, id: string, name: string): Message {
  return { role: 'assistant', seq, content: [{ type: 'tool_use', id, name, input: {} }] };
}

function toolResultMsg(seq: number, toolUseId: string, content: string): Message {
  return { role: 'user', seq, content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] };
}

describe('pruneToolOutputs', () => {
  it('leaves history untouched when nothing exceeds PRUNE_MINIMUM', () => {
    const messages: Message[] = [
      userMsg(1),
      toolUseMsg(2, 't1', 'bash'),
      toolResultMsg(3, 't1', 'small output'),
      userMsg(4),
    ];
    const result = pruneToolOutputs(messages);
    expect(result.prunedCount).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  it('prunes old, large, non-protected tool outputs once accumulated size clears PROTECT+MINIMUM', () => {
    const bigOutput = 'x'.repeat(PRUNE_PROTECT + PRUNE_MINIMUM + 1000);
    const messages: Message[] = [
      userMsg(1),
      toolUseMsg(2, 't1', 'bash'),
      toolResultMsg(3, 't1', bigOutput),
      // enough user turns after this to push it out of the protected tail
      userMsg(4),
      userMsg(5),
      userMsg(6),
    ];
    const result = pruneToolOutputs(messages, { tailTurns: 1 });
    expect(result.prunedCount).toBeGreaterThan(0);
    const prunedBlock = result.messages[2].content[0];
    expect(prunedBlock).toMatchObject({ type: 'tool_result', content: expect.stringContaining('pruned') });
  });

  it('never prunes tool outputs from protected tools (e.g. "skill")', () => {
    const bigOutput = 'x'.repeat(PRUNE_PROTECT + PRUNE_MINIMUM + 1000);
    const messages: Message[] = [
      userMsg(1),
      toolUseMsg(2, 't1', 'skill'),
      toolResultMsg(3, 't1', bigOutput),
      userMsg(4),
      userMsg(5),
      userMsg(6),
    ];
    const result = pruneToolOutputs(messages, { tailTurns: 1 });
    expect(result.prunedCount).toBe(0);
    expect(result.messages[2].content[0]).toEqual(messages[2].content[0]);
  });

  it('never prunes messages within the protected tail (last DEFAULT_TAIL_TURNS user turns)', () => {
    const bigOutput = 'x'.repeat(PRUNE_PROTECT + PRUNE_MINIMUM + 1000);
    const messages: Message[] = [
      userMsg(1),
      toolUseMsg(2, 't1', 'bash'),
      toolResultMsg(3, 't1', bigOutput),
      // only 1 more user turn after this -> stays within DEFAULT_TAIL_TURNS=2
      userMsg(4),
    ];
    expect(DEFAULT_TAIL_TURNS).toBe(2);
    const result = pruneToolOutputs(messages);
    expect(result.prunedCount).toBe(0);
  });

  it('does not prune when the prunable total is below PRUNE_MINIMUM even past PRUNE_PROTECT', () => {
    // Only slightly over PRUNE_PROTECT, but the *candidate* (prunable) portion
    // itself is tiny, so total prunable chars stays under PRUNE_MINIMUM.
    const messages: Message[] = [
      userMsg(1),
      toolUseMsg(2, 't1', 'bash'),
      toolResultMsg(3, 't1', 'x'.repeat(PRUNE_PROTECT + 100)),
      toolUseMsg(4, 't2', 'bash'),
      toolResultMsg(5, 't2', 'tiny'),
      userMsg(6),
      userMsg(7),
      userMsg(8),
    ];
    const result = pruneToolOutputs(messages, { tailTurns: 1, minimum: 999_999 });
    expect(result.prunedCount).toBe(0);
  });
});
