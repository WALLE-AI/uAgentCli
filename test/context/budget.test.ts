import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/types/message.js';
import {
  applyToolResultBudget,
  autoCompactDecision,
  COMPACTION_BUFFER,
  isOverflow,
  microcompact,
  snip,
  usableTokens,
} from '../../src/context/budget.js';

describe('usableTokens / isOverflow', () => {
  it('reserves min(COMPACTION_BUFFER, maxOutputTokens) by default', () => {
    expect(usableTokens(100_000, 4_000)).toBe(100_000 - 4_000);
    expect(usableTokens(100_000, 50_000)).toBe(100_000 - COMPACTION_BUFFER);
  });

  it('respects an explicit reservedTokens override', () => {
    expect(usableTokens(100_000, 4_000, { reservedTokens: 10_000 })).toBe(90_000);
  });

  it('never goes negative', () => {
    expect(usableTokens(1_000, 5_000)).toBe(0);
  });

  it('isOverflow is true once totalTokens reaches the usable threshold', () => {
    const input = { totalTokens: 96_001, contextLimit: 100_000, maxOutputTokens: 4_000 };
    expect(isOverflow(input)).toBe(true);
  });

  it('isOverflow is false when under the threshold', () => {
    const input = { totalTokens: 50_000, contextLimit: 100_000, maxOutputTokens: 4_000 };
    expect(isOverflow(input)).toBe(false);
  });

  it('isOverflow is false when autoCompactEnabled is explicitly false, regardless of size', () => {
    const input = {
      totalTokens: 999_999,
      contextLimit: 100_000,
      maxOutputTokens: 4_000,
      config: { autoCompactEnabled: false },
    };
    expect(isOverflow(input)).toBe(false);
  });

  it('isOverflow is false when the model reports no context limit (0)', () => {
    const input = { totalTokens: 999_999, contextLimit: 0, maxOutputTokens: 4_000 };
    expect(isOverflow(input)).toBe(false);
  });
});

describe('autoCompactDecision', () => {
  it('mirrors isOverflow as compact/skip', () => {
    expect(autoCompactDecision({ totalTokens: 10, contextLimit: 100_000, maxOutputTokens: 4_000 })).toBe(
      'skip',
    );
    expect(
      autoCompactDecision({ totalTokens: 999_999, contextLimit: 100_000, maxOutputTokens: 4_000 }),
    ).toBe('compact');
  });
});

describe('applyToolResultBudget', () => {
  it('truncates tool_result content exceeding maxChars, keeps a marker', () => {
    const messages: Message[] = [
      {
        role: 'user',
        seq: 1,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(3000) }],
      },
    ];
    const result = applyToolResultBudget(messages, 100);
    const block = result[0].content[0];
    expect(block.type).toBe('tool_result');
    if (block.type === 'tool_result' && typeof block.content === 'string') {
      expect(block.content.length).toBeLessThan(3000);
      expect(block.content).toContain('truncated');
    }
  });

  it('leaves small tool_result content untouched', () => {
    const messages: Message[] = [
      { role: 'user', seq: 1, content: [{ type: 'tool_result', tool_use_id: 't1', content: 'small' }] },
    ];
    const result = applyToolResultBudget(messages, 2000);
    expect(result[0].content[0]).toEqual(messages[0].content[0]);
  });

  it('leaves non tool_result blocks untouched', () => {
    const messages: Message[] = [{ role: 'user', seq: 1, content: [{ type: 'text', text: 'hi' }] }];
    const result = applyToolResultBudget(messages, 1);
    expect(result[0]).toEqual(messages[0]);
  });
});

describe('snip', () => {
  it('returns text unchanged when under maxLength', () => {
    expect(snip('hello', 100)).toBe('hello');
  });

  it('keeps head and tail with a marker when over maxLength', () => {
    const text = 'a'.repeat(50) + 'MIDDLE' + 'b'.repeat(50);
    const result = snip(text, 40);
    expect(result).toContain('snipped');
    expect(result.startsWith('a')).toBe(true);
    expect(result.endsWith('b')).toBe(true);
    expect(result).not.toContain('MIDDLE');
  });
});

describe('microcompact', () => {
  it('collapses a tool_result far exceeding the threshold into a one-line placeholder', () => {
    const messages: Message[] = [
      {
        role: 'user',
        seq: 1,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(10_000) }],
      },
    ];
    const result = microcompact(messages, 100);
    const block = result[0].content[0];
    expect(block.type).toBe('tool_result');
    if (block.type === 'tool_result') {
      expect(block.content).toContain('microcompacted');
    }
  });

  it('leaves content under the threshold untouched', () => {
    const messages: Message[] = [
      { role: 'user', seq: 1, content: [{ type: 'tool_result', tool_use_id: 't1', content: 'short' }] },
    ];
    const result = microcompact(messages, 1000);
    expect(result[0].content[0]).toEqual(messages[0].content[0]);
  });
});
