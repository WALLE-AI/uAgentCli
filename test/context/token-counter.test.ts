import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../../src/types/message.js';
import { TokenCounter, localEstimate } from '../../src/context/token-counter.js';

function makeMessage(seq: number, text: string): Message {
  return { role: 'user', seq, content: [{ type: 'text', text }] };
}

describe('TokenCounter', () => {
  it('caches by seq: repeated counts of the same seq only call countFn once', () => {
    const countFn = vi.fn(() => 42);
    const counter = new TokenCounter(countFn);
    const message = makeMessage(1, 'hello world');

    expect(counter.count(message)).toBe(42);
    expect(counter.count(message)).toBe(42);
    expect(counter.count(message)).toBe(42);
    expect(countFn).toHaveBeenCalledTimes(1);
  });

  it('recomputes for a different seq', () => {
    const countFn = vi.fn((m: Message) => m.seq * 10);
    const counter = new TokenCounter(countFn);
    expect(counter.count(makeMessage(1, 'a'))).toBe(10);
    expect(counter.count(makeMessage(2, 'b'))).toBe(20);
    expect(countFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to local estimate when countFn throws', () => {
    const countFn = vi.fn(() => {
      throw new Error('API unavailable');
    });
    const counter = new TokenCounter(countFn);
    const message = makeMessage(1, 'a'.repeat(40));
    expect(counter.count(message)).toBe(localEstimate(message));
  });

  it('uses local estimate by default when no countFn is injected', () => {
    const counter = new TokenCounter();
    const message = makeMessage(1, 'a'.repeat(40));
    expect(counter.count(message)).toBe(10); // 40 chars / 4
  });

  it('invalidate() forces a recount for that seq only', () => {
    const countFn = vi.fn(() => 5);
    const counter = new TokenCounter(countFn);
    const message = makeMessage(1, 'x');
    counter.count(message);
    counter.invalidate(1);
    counter.count(message);
    expect(countFn).toHaveBeenCalledTimes(2);
  });

  it('clear() resets the entire cache', () => {
    const countFn = vi.fn(() => 5);
    const counter = new TokenCounter(countFn);
    counter.count(makeMessage(1, 'x'));
    counter.count(makeMessage(2, 'y'));
    counter.clear();
    counter.count(makeMessage(1, 'x'));
    expect(countFn).toHaveBeenCalledTimes(3);
  });
});

describe('localEstimate', () => {
  it('approximates tokens across text/thinking/tool_use/tool_result blocks', () => {
    const message: Message = {
      role: 'assistant',
      seq: 1,
      content: [
        { type: 'text', text: 'abcd' },
        { type: 'thinking', thinking: 'efgh' },
        { type: 'tool_use', id: 't1', name: 'read', input: { path: 'x' } },
      ],
    };
    expect(localEstimate(message)).toBeGreaterThan(0);
  });

  it('image blocks contribute no text length', () => {
    const message: Message = {
      role: 'user',
      seq: 1,
      content: [{ type: 'image', source: { type: 'url', url: 'http://x' } }],
    };
    expect(localEstimate(message)).toBe(0);
  });
});
