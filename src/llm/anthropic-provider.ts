import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import type { ContentBlock, Message } from '../types/message.js';
import type { ToolDef } from '../tool/types.js';
import type { LlmEvent, LlmProvider, LlmRequest } from './types.js';
import { resolveProxyAgent } from './proxy-agent.js';
import {
  ContentFilterError,
  ContextLengthExceededError,
  OverloadError,
  RateLimitError,
} from './errors.js';

/**
 * §D 极简 zod→JSON Schema 转换：只覆盖本项目内置工具用到的形状
 * （object/string/number/boolean/array/optional），不是通用转换器。
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }
    return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
  }
  if (schema instanceof z.ZodString) {
    return { type: 'string' };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: 'number' };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element as z.ZodTypeAny) };
  }
  return {};
}

function toSdkBlock(block: ContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'thinking':
      return { type: 'thinking', thinking: block.thinking, signature: block.signature };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
        is_error: block.is_error,
      };
    case 'image':
      return { type: 'image', source: block.source };
  }
}

/** `Message[] → Anthropic SDK messages` 映射，system 角色单独处理不进 messages 数组。 */
export function toSdkMessages(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: unknown[] }> {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.map(toSdkBlock) }));
}

export function toSdkTools(tools: ToolDef[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    name: tool.id,
    description: tool.description,
    input_schema: zodToJsonSchema(tool.parameters),
  }));
}

interface SdkErrorLike {
  status?: number;
  message?: string;
  error?: { type?: string; message?: string };
}

function mapSdkError(error: unknown): Error {
  if (
    error instanceof RateLimitError ||
    error instanceof OverloadError ||
    error instanceof ContextLengthExceededError ||
    error instanceof ContentFilterError
  ) {
    return error;
  }

  const err = (typeof error === 'object' && error !== null ? error : {}) as SdkErrorLike;
  const status = err.status;
  const type = err.error?.type;
  const message = err.message ?? err.error?.message ?? 'unknown provider error';

  if (status === 429 || type === 'rate_limit_error') {
    return new RateLimitError(message);
  }
  if (status === 529 || type === 'overloaded_error') {
    return new OverloadError(message);
  }
  if (type === 'invalid_request_error' && /too long|maximum context|context length/i.test(message)) {
    return new ContextLengthExceededError(message);
  }
  if (type === 'content_filter' || /content.?filter/i.test(message)) {
    return new ContentFilterError(message);
  }
  return error instanceof Error ? error : new Error(message);
}

function finishReasonFor(reason: string | null | undefined): 'end_turn' | 'tool_use' | 'max_tokens' | 'error' {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    default:
      return 'error';
  }
}

interface AnthropicRawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicRawEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string };
  message?: { usage?: AnthropicRawUsage };
  usage?: AnthropicRawUsage;
}

interface AccumulatedUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

function mergeUsage(previous: AccumulatedUsage | undefined, raw: AnthropicRawUsage | undefined): AccumulatedUsage | undefined {
  if (!raw) {
    return previous;
  }
  return {
    inputTokens: raw.input_tokens ?? previous?.inputTokens,
    outputTokens: raw.output_tokens ?? previous?.outputTokens,
    cacheCreationInputTokens: raw.cache_creation_input_tokens ?? previous?.cacheCreationInputTokens,
    cacheReadInputTokens: raw.cache_read_input_tokens ?? previous?.cacheReadInputTokens,
  };
}

/**
 * 消费 Anthropic 原始流式事件，映射成归一化 `LlmEvent`。`message_start`
 * 携带含 cache_creation_input_tokens/cache_read_input_tokens 的初始
 * usage；`message_delta` 携带增量 output_tokens——两者合并后挂在
 * `finish` 事件上，供 T4.8 人工核对缓存断点连续命中。
 */
async function* mapAnthropicStream(rawEvents: AsyncIterable<AnthropicRawEvent>): AsyncGenerator<LlmEvent> {
  const toolAccum = new Map<number, { id: string; name: string; jsonParts: string[] }>();
  let usage: AccumulatedUsage | undefined;

  for await (const event of rawEvents) {
    switch (event.type) {
      case 'message_start': {
        usage = mergeUsage(usage, event.message?.usage);
        break;
      }
      case 'content_block_start': {
        const block = event.content_block;
        if (block?.type === 'tool_use' && event.index !== undefined) {
          toolAccum.set(event.index, { id: block.id ?? '', name: block.name ?? '', jsonParts: [] });
        }
        break;
      }
      case 'content_block_delta': {
        const delta = event.delta;
        if (delta?.type === 'text_delta' && delta.text !== undefined) {
          yield { type: 'text_delta', text: delta.text };
        } else if (delta?.type === 'thinking_delta' && delta.thinking !== undefined) {
          yield { type: 'thinking', text: delta.thinking };
        } else if (delta?.type === 'input_json_delta' && event.index !== undefined) {
          const acc = toolAccum.get(event.index);
          if (acc && delta.partial_json !== undefined) {
            acc.jsonParts.push(delta.partial_json);
          }
        }
        break;
      }
      case 'content_block_stop': {
        if (event.index !== undefined) {
          const acc = toolAccum.get(event.index);
          if (acc) {
            const jsonText = acc.jsonParts.join('');
            let input: Record<string, unknown> = {};
            try {
              input = jsonText ? (JSON.parse(jsonText) as Record<string, unknown>) : {};
            } catch {
              input = {};
            }
            yield { type: 'tool_call', id: acc.id, name: acc.name, input };
            toolAccum.delete(event.index);
          }
        }
        break;
      }
      case 'message_delta': {
        usage = mergeUsage(usage, event.usage);
        if (event.delta?.stop_reason) {
          yield { type: 'finish', reason: finishReasonFor(event.delta.stop_reason), usage };
        }
        break;
      }
      default:
        break;
    }
  }
}

export interface AnthropicClientLike {
  messages: {
    stream(params: Record<string, unknown>, options?: { signal?: AbortSignal }): AsyncIterable<AnthropicRawEvent>;
  };
}

export interface CreateAnthropicProviderOptions {
  apiKey?: string;
  client?: AnthropicClientLike;
}

/** system 字符串本迭代只打一个 cache_control 断点（范围简化，见迭代4计划）。 */
export function buildSystemBlocks(system: string): Array<Record<string, unknown>> {
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

export function createAnthropicProvider(options: CreateAnthropicProviderOptions = {}): LlmProvider {
  const client: AnthropicClientLike =
    options.client ??
    (new Anthropic({ apiKey: options.apiKey, httpAgent: resolveProxyAgent() }) as unknown as AnthropicClientLike);

  return {
    async *streamChat(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
      let rawStream: AsyncIterable<AnthropicRawEvent>;
      try {
        rawStream = client.messages.stream(
          {
            model: request.model,
            system: buildSystemBlocks(request.system),
            messages: toSdkMessages(request.messages),
            tools: toSdkTools(request.tools),
            max_tokens: request.maxTokens ?? 4096,
          },
          { signal },
        );
      } catch (error) {
        throw mapSdkError(error);
      }

      try {
        for await (const event of mapAnthropicStream(rawStream)) {
          if (signal.aborted) {
            return;
          }
          yield event;
        }
      } catch (error) {
        throw mapSdkError(error);
      }
    },
  };
}
