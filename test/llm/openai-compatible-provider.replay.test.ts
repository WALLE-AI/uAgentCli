import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadReplayFixture, replayEvents } from '../helpers/replay.js';
import {
  createOpenAiCompatibleProvider,
  toOpenAiMessages,
  toOpenAiTools,
  type OpenAiCompatibleClientLike,
} from '../../src/llm/openai-compatible-provider.js';
import {
  ContentFilterError,
  ContextLengthExceededError,
  OverloadError,
  RateLimitError,
} from '../../src/llm/errors.js';
import type { LlmEvent, LlmRequest } from '../../src/llm/types.js';
import type { Message } from '../../src/types/message.js';
import type { ToolDef } from '../../src/tool/types.js';
import { resolveOpenAiEndpoint, readEndpointApiKey } from '../../src/llm/provider-config.js';

function fakeClient(fixtureName: string): OpenAiCompatibleClientLike {
  return {
    chat: {
      completions: {
        create: () => replayEvents(loadReplayFixture(fixtureName)),
      },
    },
  };
}

function throwingClient(error: unknown): OpenAiCompatibleClientLike {
  return {
    chat: {
      completions: {
        create: () => {
          throw error;
        },
      },
    },
  };
}

const BASE_REQUEST: LlmRequest = {
  model: 'gpt-4o',
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', seq: 1, content: [{ type: 'text', text: 'hi' }] }],
  tools: [],
};

async function consumeAll(provider: ReturnType<typeof createOpenAiCompatibleProvider>) {
  const controller = new AbortController();
  const events: LlmEvent[] = [];
  for await (const event of provider.streamChat(BASE_REQUEST, controller.signal)) {
    events.push(event);
  }
  return events;
}

describe('openai-compatible-provider: streaming event mapping (replay, no real API calls)', () => {
  it('maps content chunks and concatenates them into the full text', async () => {
    const provider = createOpenAiCompatibleProvider({ client: fakeClient('openai-text') });
    const events = await consumeAll(provider);

    const textEvents = events.filter((e): e is { type: 'text_delta'; text: string } => e.type === 'text_delta');
    expect(textEvents.map((e) => e.text).join('')).toBe('Hello world');
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'end_turn', usage: undefined });
  });

  it('accumulates tool_calls deltas (by index) into a parsed tool_call event', async () => {
    const provider = createOpenAiCompatibleProvider({ client: fakeClient('openai-tool-call') });
    const events = await consumeAll(provider);

    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toEqual({ type: 'tool_call', id: 'call_1', name: 'bash', input: { command: 'ls -la' } });
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_use', usage: undefined });
  });

  it('attaches usage (prompt/completion tokens) from the final chunk to the finish event', async () => {
    const provider = createOpenAiCompatibleProvider({ client: fakeClient('openai-text-with-usage') });
    const events = await consumeAll(provider);

    const finish = events.find((e) => e.type === 'finish');
    expect(finish).toMatchObject({
      type: 'finish',
      reason: 'end_turn',
      usage: { inputTokens: 500, outputTokens: 3 },
    });
  });

  it('maps SDK errors to normalized error types', async () => {
    await expect(
      consumeAll(createOpenAiCompatibleProvider({ client: throwingClient({ status: 429, message: 'slow down' }) })),
    ).rejects.toBeInstanceOf(RateLimitError);

    await expect(
      consumeAll(createOpenAiCompatibleProvider({ client: throwingClient({ status: 503, error: { type: 'server_error' } }) })),
    ).rejects.toBeInstanceOf(OverloadError);

    await expect(
      consumeAll(
        createOpenAiCompatibleProvider({
          client: throwingClient({ error: { code: 'context_length_exceeded', message: 'too long' } }),
        }),
      ),
    ).rejects.toBeInstanceOf(ContextLengthExceededError);

    await expect(
      consumeAll(
        createOpenAiCompatibleProvider({ client: throwingClient({ error: { type: 'content_filter', message: 'blocked' } }) }),
      ),
    ).rejects.toBeInstanceOf(ContentFilterError);
  });
});

describe('toOpenAiMessages / toOpenAiTools (Message<->SDK field mapping)', () => {
  it('maps assistant text + tool_use into content + tool_calls', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        seq: 1,
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 't1', name: 'read', input: { path: 'x' } },
        ],
      },
    ];
    expect(toOpenAiMessages(messages, '')).toEqual([
      {
        role: 'assistant',
        content: 'let me check',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'read', arguments: '{"path":"x"}' } }],
      },
    ]);
  });

  it('splits a user message carrying tool_result blocks into separate role:"tool" messages', () => {
    const messages: Message[] = [
      {
        role: 'user',
        seq: 1,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file contents', is_error: false }],
      },
    ];
    expect(toOpenAiMessages(messages, '')).toEqual([{ role: 'tool', tool_call_id: 't1', content: 'file contents' }]);
  });

  it('prepends a system message when system text is non-empty', () => {
    const messages: Message[] = [{ role: 'user', seq: 1, content: [{ type: 'text', text: 'hi' }] }];
    expect(toOpenAiMessages(messages, 'be helpful')).toEqual([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('converts ToolDef zod schemas into OpenAI function-tool shape', () => {
    const tools: ToolDef[] = [
      {
        id: 'read',
        description: 'read a file',
        parameters: z.object({ file_path: z.string() }),
        execute: async () => ({ output: '' }),
      },
    ];
    expect(toOpenAiTools(tools)).toEqual([
      {
        type: 'function',
        function: {
          name: 'read',
          description: 'read a file',
          parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
        },
      },
    ]);
  });
});

describe('provider-config: OpenAI-compatible endpoint table', () => {
  it('resolves built-in endpoints (openai/deepseek/qwen/openrouter) by name', () => {
    expect(resolveOpenAiEndpoint('deepseek').baseURL).toBe('https://api.deepseek.com/v1');
    expect(resolveOpenAiEndpoint('openrouter').quirks).toEqual({ omitStreamOptions: true });
  });

  it('falls back to a custom config for unknown endpoint names, or throws with neither', () => {
    expect(() => resolveOpenAiEndpoint('acme-internal')).toThrow(/No OpenAI-compatible endpoint config/);
    const custom = resolveOpenAiEndpoint('acme-internal', { custom: { apiKeyEnvVar: 'ACME_API_KEY' } });
    expect(custom.apiKeyEnvVar).toBe('ACME_API_KEY');
  });

  it('reads the API key from the configured env var name, not a hardcoded one', () => {
    const config = resolveOpenAiEndpoint('deepseek');
    expect(readEndpointApiKey(config, { DEEPSEEK_API_KEY: 'sk-test' } as NodeJS.ProcessEnv)).toBe('sk-test');
  });
});
