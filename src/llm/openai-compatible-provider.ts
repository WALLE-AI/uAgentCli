import OpenAI from 'openai';

import type { ContentBlock, Message, TextBlock, ToolResultBlock, ToolUseBlock } from '../types/message.js';
import type { ToolDef } from '../tool/types.js';
import { zodToJsonSchema } from './anthropic-provider.js';
import { resolveProxyAgent } from './proxy-agent.js';
import type { LlmEvent, LlmProvider, LlmRequest, LlmUsage } from './types.js';
import {
  ContentFilterError,
  ContextLengthExceededError,
  OverloadError,
  RateLimitError,
} from './errors.js';

/**
 * §D OpenAI Chat Completions 族的 Message↔SDK 映射。这一族（OpenAI 官方/
 * DeepSeek/Qwen/OpenRouter/自定义端点）**不享受 Anthropic 的三层缓存前缀
 * 纪律**——本模块只保证"工具→审批→执行→续跑"链路行为一致，不承诺缓存
 * 命中一致（见迭代6计划 P1-2 风险项）。
 */
export function toOpenAiMessages(messages: Message[], system: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (system) {
    out.push({ role: 'system', content: system });
  }

  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }

    if (message.role === 'assistant') {
      out.push(assistantMessageToOpenAi(message.content));
      continue;
    }

    // user 角色：可能混有纯文本与 tool_result 块——tool_result 各自拆成
    // 独立的 role:'tool' 消息，剩余文本合成一条 role:'user' 消息。
    const toolResults = message.content.filter((b): b is ToolResultBlock => b.type === 'tool_result');
    for (const result of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: result.tool_use_id,
        content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
      });
    }
    const text = joinText(message.content);
    if (text) {
      out.push({ role: 'user', content: text });
    }
  }

  return out;
}

function joinText(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function assistantMessageToOpenAi(content: ContentBlock[]): Record<string, unknown> {
  const text = joinText(content);
  const toolUses = content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
  const entry: Record<string, unknown> = { role: 'assistant', content: text || null };
  if (toolUses.length > 0) {
    entry.tool_calls = toolUses.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.input) },
    }));
  }
  return entry;
}

export function toOpenAiTools(tools: ToolDef[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters),
    },
  }));
}

interface OpenAiErrorLike {
  status?: number;
  message?: string;
  error?: { type?: string; code?: string; message?: string };
}

function mapOpenAiError(error: unknown): Error {
  if (
    error instanceof RateLimitError ||
    error instanceof OverloadError ||
    error instanceof ContextLengthExceededError ||
    error instanceof ContentFilterError
  ) {
    return error;
  }

  const err = (typeof error === 'object' && error !== null ? error : {}) as OpenAiErrorLike;
  const status = err.status;
  const type = err.error?.type;
  const code = err.error?.code;
  const message = err.message ?? err.error?.message ?? 'unknown provider error';

  if (status === 429 || type === 'rate_limit_error' || type === 'insufficient_quota') {
    return new RateLimitError(message);
  }
  if (status === 500 || status === 503 || type === 'server_error') {
    return new OverloadError(message);
  }
  if (code === 'context_length_exceeded' || /maximum context length|context length/i.test(message)) {
    return new ContextLengthExceededError(message);
  }
  if (type === 'content_filter' || /content.?filter/i.test(message)) {
    return new ContentFilterError(message);
  }
  return error instanceof Error ? error : new Error(message);
}

function finishReasonFor(reason: string | null | undefined): 'end_turn' | 'tool_use' | 'max_tokens' | 'content_filter' | 'error' {
  switch (reason) {
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'content_filter';
    case 'stop':
      return 'end_turn';
    default:
      return 'error';
  }
}

interface OpenAiStreamToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiStreamChoice {
  delta: { content?: string | null; tool_calls?: OpenAiStreamToolCallDelta[] };
  finish_reason?: string | null;
}

interface OpenAiStreamChunk {
  choices?: OpenAiStreamChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * 消费 OpenAI Chat Completions 流式分片：`tool_calls` 按 `index` 累积
 * （id/name 通常只在首个分片出现，`arguments` 跨分片增量拼接），
 * `finish_reason` 到达时把已累积的工具调用一次性 flush 成 `tool_call`
 * 事件，再吐 `finish`。
 */
async function* mapOpenAiStream(rawChunks: AsyncIterable<OpenAiStreamChunk>): AsyncGenerator<LlmEvent> {
  const toolAccum = new Map<number, { id: string; name: string; argParts: string[] }>();
  let usage: LlmUsage | undefined;

  for await (const chunk of rawChunks) {
    if (chunk.usage) {
      usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
    }

    const choice = chunk.choices?.[0];
    if (!choice) {
      continue;
    }

    if (choice.delta?.content) {
      yield { type: 'text_delta', text: choice.delta.content };
    }

    for (const toolCallDelta of choice.delta?.tool_calls ?? []) {
      const acc = toolAccum.get(toolCallDelta.index) ?? { id: '', name: '', argParts: [] };
      if (toolCallDelta.id) acc.id = toolCallDelta.id;
      if (toolCallDelta.function?.name) acc.name = toolCallDelta.function.name;
      if (toolCallDelta.function?.arguments) acc.argParts.push(toolCallDelta.function.arguments);
      toolAccum.set(toolCallDelta.index, acc);
    }

    if (choice.finish_reason) {
      for (const acc of toolAccum.values()) {
        let input: Record<string, unknown> = {};
        try {
          input = acc.argParts.length > 0 ? (JSON.parse(acc.argParts.join('')) as Record<string, unknown>) : {};
        } catch {
          input = {};
        }
        yield { type: 'tool_call', id: acc.id, name: acc.name, input };
      }
      toolAccum.clear();
      yield { type: 'finish', reason: finishReasonFor(choice.finish_reason), usage };
    }
  }
}

export interface OpenAiCompatibleClientLike {
  chat: {
    completions: {
      /**
       * 真实 `openai` SDK 的 `create({stream:true})` 返回 `Promise<Stream>`
       * （不像 Anthropic 的 `.stream()` 那样直接同步返回可迭代对象），
       * 调用方必须先 `await` 才能拿到真正的 async iterable。
       */
      create(
        params: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ): AsyncIterable<OpenAiStreamChunk> | Promise<AsyncIterable<OpenAiStreamChunk>>;
    };
  };
}

/**
 * 端点特有的参数裁剪点：部分兼容端点（DeepSeek/Qwen/OpenRouter/自定义）
 * 不支持某些标准参数，通过 quirks 而非分支硬编码适配。
 */
export interface OpenAiQuirks {
  omitStreamOptions?: boolean;
  extraBody?: Record<string, unknown>;
}

export interface CreateOpenAiCompatibleProviderOptions {
  apiKey?: string;
  baseURL?: string;
  extraHeaders?: Record<string, string>;
  quirks?: OpenAiQuirks;
  client?: OpenAiCompatibleClientLike;
}

export function createOpenAiCompatibleProvider(options: CreateOpenAiCompatibleProviderOptions = {}): LlmProvider {
  const client: OpenAiCompatibleClientLike =
    options.client ??
    (new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      defaultHeaders: options.extraHeaders,
      httpAgent: resolveProxyAgent(),
    }) as unknown as OpenAiCompatibleClientLike);

  return {
    async *streamChat(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
      let rawStream: AsyncIterable<OpenAiStreamChunk>;
      try {
        rawStream = await client.chat.completions.create(
          {
            model: request.model,
            messages: toOpenAiMessages(request.messages, request.system),
            tools: toOpenAiTools(request.tools),
            max_tokens: request.maxTokens ?? 4096,
            stream: true,
            ...(options.quirks?.omitStreamOptions ? {} : { stream_options: { include_usage: true } }),
            ...(options.quirks?.extraBody ?? {}),
          },
          { signal },
        );
      } catch (error) {
        throw mapOpenAiError(error);
      }

      try {
        for await (const event of mapOpenAiStream(rawStream)) {
          if (signal.aborted) {
            return;
          }
          yield event;
        }
      } catch (error) {
        throw mapOpenAiError(error);
      }
    },
  };
}
