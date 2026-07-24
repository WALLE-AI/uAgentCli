import type { Message } from '../types/message.js';
import type { ToolDef } from '../tool/types.js';

/**
 * §A/§H 归一化事件流：所有 provider 的原始 SDK 事件都映射成这四类，
 * run-loop 只认识这个形状，不感知具体 provider 的流式协议差异。
 */
export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Anthropic 专有：cache_control 命中相关字段，供人工核对缓存断点是否连续命中。 */
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export type LlmEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'finish';
      reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'content_filter' | 'error';
      usage?: LlmUsage;
    };

export interface LlmRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolDef[];
  maxTokens?: number;
}

export interface LlmProvider {
  streamChat(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmEvent>;
}
