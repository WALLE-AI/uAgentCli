import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/types/message.js';
import { compactEpoch, initialEpoch, visibleHistory } from '../../src/context/epoch.js';

function msg(seq: number, text = 'x'): Message {
  return { role: 'user', seq, content: [{ type: 'text', text }] };
}

describe('compactEpoch', () => {
  it('replaces the pre-boundary range with a single summary message', () => {
    const messages = [msg(1), msg(2), msg(3), msg(4), msg(5)];
    const summary: Message = { role: 'assistant', seq: 4, content: [{ type: 'text', text: 'summary' }] };

    const result = compactEpoch({ epoch: initialEpoch(), messages, summaryMessage: summary });

    expect(result.messages).toEqual([summary, msg(4), msg(5)]);
  });

  it('moves baselineSeq forward to the summary message seq', () => {
    const messages = [msg(1), msg(2), msg(3)];
    const summary: Message = { role: 'assistant', seq: 3, content: [{ type: 'text', text: 'summary' }] };
    const result = compactEpoch({ epoch: initialEpoch(), messages, summaryMessage: summary });
    expect(result.epoch.baselineSeq).toBe(3);
    expect(result.epoch.baselineSeq).toBeGreaterThan(initialEpoch().baselineSeq);
  });

  it('keeps messages at/after the boundary seq unchanged', () => {
    const messages = [msg(1), msg(2), msg(3), msg(4)];
    const summary: Message = { role: 'assistant', seq: 3, content: [{ type: 'text', text: 'summary' }] };
    const result = compactEpoch({ epoch: initialEpoch(), messages, summaryMessage: summary });
    expect(result.messages).toEqual([summary, msg(3), msg(4)]);
  });

  it('does not mutate the original messages array (pure function)', () => {
    const messages = [msg(1), msg(2), msg(3)];
    const snapshot = JSON.parse(JSON.stringify(messages));
    const summary: Message = { role: 'assistant', seq: 3, content: [{ type: 'text', text: 'summary' }] };
    compactEpoch({ epoch: initialEpoch(), messages, summaryMessage: summary });
    expect(messages).toEqual(snapshot);
  });

  it('throws (leaving no half-state) when there is nothing before the boundary to compact', () => {
    const messages = [msg(5), msg(6)];
    const snapshot = [...messages];
    const summary: Message = { role: 'assistant', seq: 1, content: [{ type: 'text', text: 'summary' }] };

    expect(() => compactEpoch({ epoch: initialEpoch(), messages, summaryMessage: summary })).toThrow();
    // original array untouched after the throw
    expect(messages).toEqual(snapshot);
  });
});

describe('visibleHistory', () => {
  it('excludes messages before baselineSeq', () => {
    const messages = [msg(1), msg(2), msg(3), msg(4)];
    expect(visibleHistory({ baselineSeq: 3 }, messages)).toEqual([msg(3), msg(4)]);
  });

  it('returns everything when baselineSeq is 0 (initial epoch)', () => {
    const messages = [msg(1), msg(2)];
    expect(visibleHistory(initialEpoch(), messages)).toEqual(messages);
  });
});
