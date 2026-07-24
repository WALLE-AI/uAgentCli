import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadReplayFixture, replayEvents } from '../helpers/replay.js';
import {
  buildSystemBlocks,
  createAnthropicProvider,
  toSdkMessages,
  toSdkTools,
  type AnthropicClientLike,
} from '../../src/llm/anthropic-provider.js';
import {
  ContentFilterError,
  ContextLengthExceededError,
  OverloadError,
  RateLimitError,
} from '../../src/llm/errors.js';
import type { LlmEvent, LlmRequest } from '../../src/llm/types.js';
import type { Message } from '../../src/types/message.js';
import type { ToolDef } from '../../src/tool/types.js';

function fakeClient(fixtureName: string): AnthropicClientLike {
  return {
    messages: {
      stream: () => replayEvents(loadReplayFixture(fixtureName)),
    },
  };
}

function throwingClient(error: unknown): AnthropicClientLike {
  return {
    messages: {
      stream: () => {
        throw error;
      },
    },
  };
}

const BASE_REQUEST: LlmRequest = {
  model: 'claude-sonnet-5',
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', seq: 1, content: [{ type: 'text', text: 'hi' }] }],
  tools: [],
};

describe('anthropic-provider: streaming event mapping (replay, no real API calls)', () => {
  it('maps text_delta chunks and concatenates them into the full text', async () => {
    const provider = createAnthropicProvider({ client: fakeClient('anthropic-text') });
    const controller = new AbortController();

    const events: LlmEvent[] = [];
    for await (const event of provider.streamChat(BASE_REQUEST, controller.signal)) {
      events.push(event);
    }

    const textEvents = events.filter((e): e is { type: 'text_delta'; text: string } => e.type === 'text_delta');
    expect(textEvents.map((e) => e.text).join('')).toBe('Hello world');
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'end_turn' });
  });

  it('accumulates input_json_delta chunks into a parsed tool_call event', async () => {
    const provider = createAnthropicProvider({ client: fakeClient('anthropic-tool-call') });
    const controller = new AbortController();

    const events: LlmEvent[] = [];
    for await (const event of provider.streamChat(BASE_REQUEST, controller.signal)) {
      events.push(event);
    }

    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toEqual({ type: 'tool_call', id: 'toolu_1', name: 'bash', input: { command: 'ls -la' } });
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_use' });
  });

  it('attaches merged usage (including cache token fields) from message_start + message_delta to the finish event', async () => {
    const provider = createAnthropicProvider({ client: fakeClient('anthropic-text-with-usage') });
    const controller = new AbortController();

    const events: LlmEvent[] = [];
    for await (const event of provider.streamChat(BASE_REQUEST, controller.signal)) {
      events.push(event);
    }

    const finish = events.find((e) => e.type === 'finish');
    expect(finish).toMatchObject({
      type: 'finish',
      reason: 'end_turn',
      usage: {
        inputTokens: 500,
        outputTokens: 3,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 1200,
      },
    });
  });

  it('maps SDK errors to normalized error types', async () => {
    const providerRateLimit = createAnthropicProvider({
      client: throwingClient({ status: 429, message: 'slow down' }),
    });
    await expect(consumeAll(providerRateLimit)).rejects.toBeInstanceOf(RateLimitError);

    const providerOverload = createAnthropicProvider({
      client: throwingClient({ status: 529, error: { type: 'overloaded_error' } }),
    });
    await expect(consumeAll(providerOverload)).rejects.toBeInstanceOf(OverloadError);

    const providerContext = createAnthropicProvider({
      client: throwingClient({
        error: { type: 'invalid_request_error', message: 'prompt is too long: context length exceeded' },
      }),
    });
    await expect(consumeAll(providerContext)).rejects.toBeInstanceOf(ContextLengthExceededError);

    const providerContentFilter = createAnthropicProvider({
      client: throwingClient({ error: { type: 'content_filter', message: 'blocked' } }),
    });
    await expect(consumeAll(providerContentFilter)).rejects.toBeInstanceOf(ContentFilterError);
  });
});

async function consumeAll(provider: ReturnType<typeof createAnthropicProvider>) {
  const controller = new AbortController();
  const events: LlmEvent[] = [];
  for await (const event of provider.streamChat(BASE_REQUEST, controller.signal)) {
    events.push(event);
  }
  return events;
}

describe('toSdkMessages / toSdkTools / buildSystemBlocks (Message<->SDK field mapping)', () => {
  it('maps each ContentBlock type field-by-field', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        seq: 1,
        content: [
          { type: 'text', text: 'hi' },
          { type: 'thinking', thinking: 'reasoning', signature: 'sig' },
          { type: 'tool_use', id: 't1', name: 'read', input: { path: 'x' } },
          { type: 'tool_result', tool_use_id: 't1', content: 'output', is_error: false },
          { type: 'image', source: { type: 'url', url: 'http://x' } },
        ],
      },
    ];
    const sdkMessages = toSdkMessages(messages);
    expect(sdkMessages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'thinking', thinking: 'reasoning', signature: 'sig' },
          { type: 'tool_use', id: 't1', name: 'read', input: { path: 'x' } },
          { type: 'tool_result', tool_use_id: 't1', content: 'output', is_error: false },
          { type: 'image', source: { type: 'url', url: 'http://x' } },
        ],
      },
    ]);
  });

  it('excludes system-role messages from the mapped array (system is passed separately)', () => {
    const messages: Message[] = [{ role: 'system', seq: 1, content: [{ type: 'text', text: 'sys' }] }];
    expect(toSdkMessages(messages)).toEqual([]);
  });

  it('converts ToolDef zod schemas into a JSON-schema-shaped input_schema', () => {
    const tools: ToolDef[] = [
      {
        id: 'read',
        description: 'read a file',
        parameters: z.object({ file_path: z.string(), limit: z.number().optional() }),
        execute: async () => ({ output: '' }),
      },
    ];
    const sdkTools = toSdkTools(tools);
    expect(sdkTools).toEqual([
      {
        name: 'read',
        description: 'read a file',
        input_schema: {
          type: 'object',
          properties: { file_path: { type: 'string' }, limit: { type: 'number' } },
          required: ['file_path'],
        },
      },
    ]);
  });

  it('wraps the system string as a single cache_control-marked text block', () => {
    expect(buildSystemBlocks('You are helpful.')).toEqual([
      { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
    ]);
  });
});
