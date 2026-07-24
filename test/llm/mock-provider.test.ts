import { describe, expect, it } from 'vitest';
import type { LlmEvent, LlmRequest } from '../../src/llm/types.js';
import { createMockProvider } from '../../src/llm/mock-provider.js';

const REQUEST: LlmRequest = { model: 'claude-sonnet-5', system: '', messages: [], tools: [] };

describe('createMockProvider', () => {
  it('yields the preset event sequence deterministically', async () => {
    const events: LlmEvent[] = [
      { type: 'text_delta', text: 'hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'finish', reason: 'end_turn' },
    ];
    const provider = createMockProvider(events);
    const controller = new AbortController();

    const seen: LlmEvent[] = [];
    for await (const event of provider.streamChat(REQUEST, controller.signal)) {
      seen.push(event);
    }
    expect(seen).toEqual(events);
  });

  it('stops iterating once the signal is aborted mid-stream', async () => {
    const events: LlmEvent[] = [
      { type: 'text_delta', text: 'a' },
      { type: 'text_delta', text: 'b' },
      { type: 'text_delta', text: 'c' },
      { type: 'finish', reason: 'end_turn' },
    ];
    const provider = createMockProvider(events);
    const controller = new AbortController();

    const seen: LlmEvent[] = [];
    for await (const event of provider.streamChat(REQUEST, controller.signal)) {
      seen.push(event);
      if (seen.length === 2) {
        controller.abort();
      }
    }
    expect(seen).toEqual([events[0], events[1]]);
  });

  it('yields nothing when the signal is already aborted before iteration starts', async () => {
    const provider = createMockProvider([{ type: 'text_delta', text: 'x' }]);
    const controller = new AbortController();
    controller.abort();

    const seen: LlmEvent[] = [];
    for await (const event of provider.streamChat(REQUEST, controller.signal)) {
      seen.push(event);
    }
    expect(seen).toEqual([]);
  });

  it('constructs all four LlmEvent variants correctly', () => {
    const events: LlmEvent[] = [
      { type: 'text_delta', text: 'a' },
      { type: 'thinking', text: 'reasoning...' },
      { type: 'tool_call', id: 't1', name: 'read', input: { path: 'x' } },
      { type: 'finish', reason: 'tool_use' },
    ];
    for (const e of events) {
      expect(e.type).toBeDefined();
    }
  });
});
