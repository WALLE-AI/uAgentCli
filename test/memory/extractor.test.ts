import { describe, expect, it } from 'vitest';
import { toSessionID } from '../../src/types/ids.js';
import { TokenCounter } from '../../src/context/token-counter.js';
import { createMemoryDb } from '../helpers/sqlite.js';
import { LongTermMemoryStore } from '../../src/memory/long-term-store.js';
import { runMemoryExtraction, shouldTriggerExtraction } from '../../src/memory/extractor.js';
import { createMockProvider } from '../../src/llm/mock-provider.js';
import type { Message } from '../../src/types/message.js';

function msg(seq: number, role: Message['role'], text: string): Message {
  return { role, seq, content: [{ type: 'text', text }] };
}

describe('shouldTriggerExtraction', () => {
  it('does not trigger every turn — only once the message-count threshold is crossed', () => {
    expect(shouldTriggerExtraction(5, 0, { everyNMessages: 20 })).toBe(false);
    expect(shouldTriggerExtraction(20, 0, { everyNMessages: 20 })).toBe(true);
    expect(shouldTriggerExtraction(25, 20, { everyNMessages: 20 })).toBe(false);
    expect(shouldTriggerExtraction(40, 20, { everyNMessages: 20 })).toBe(true);
  });
});

describe('runMemoryExtraction', () => {
  it('writes one long-term-store entry per extracted line, namespaced under agentName', async () => {
    const store = new LongTermMemoryStore(createMemoryDb());
    const provider = createMockProvider([
      { type: 'text_delta', text: 'user prefers TypeScript\nuser is debugging a flaky test' },
      { type: 'finish', reason: 'end_turn' },
    ]);

    const result = await runMemoryExtraction({
      agentName: 'build',
      history: [msg(1, 'user', 'I prefer TypeScript over JS.'), msg(2, 'assistant', 'Noted.')],
      provider,
      tokenCounter: new TokenCounter(() => 1),
      model: { id: 'claude-sonnet-5' },
      agentPrompt: 'Extract memory items.',
      store,
      parentSessionID: toSessionID('parent-1'),
    });

    expect(result.writtenIds).toHaveLength(2);
    const entries = store.retrieve('build', 10);
    expect(entries.map((e) => e.content).sort()).toEqual(
      ['user is debugging a flaky test', 'user prefers TypeScript'].sort(),
    );
  });

  it('does not leak any other state back to the parent session (only writes memory entries)', async () => {
    const store = new LongTermMemoryStore(createMemoryDb());
    const provider = createMockProvider([
      { type: 'text_delta', text: 'a single memory item' },
      { type: 'finish', reason: 'end_turn' },
    ]);

    const parentSessionID = toSessionID('parent-2');
    await runMemoryExtraction({
      agentName: 'build',
      history: [msg(1, 'user', 'hello')],
      provider,
      tokenCounter: new TokenCounter(() => 1),
      model: { id: 'claude-sonnet-5' },
      agentPrompt: 'Extract memory items.',
      store,
      parentSessionID,
    });

    // 记忆命名空间按 agentName 隔离，抽取子任务本身不会写入以父 sessionID 命名的条目。
    const parentNamed = store.retrieve(parentSessionID, 10);
    expect(parentNamed).toHaveLength(0);
  });

  it('produces no entries when the extractor returns nothing extractable (blank output)', async () => {
    const store = new LongTermMemoryStore(createMemoryDb());
    const provider = createMockProvider([{ type: 'finish', reason: 'end_turn' }]);

    const result = await runMemoryExtraction({
      agentName: 'build',
      history: [msg(1, 'user', 'hi')],
      provider,
      tokenCounter: new TokenCounter(() => 1),
      model: { id: 'claude-sonnet-5' },
      agentPrompt: 'Extract memory items.',
      store,
      parentSessionID: toSessionID('parent-3'),
    });

    expect(result.writtenIds).toHaveLength(0);
    expect(store.retrieve('build', 10)).toHaveLength(0);
  });
});
