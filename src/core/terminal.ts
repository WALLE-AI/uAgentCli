import type { ContentBlock } from '../types/message.js';

export type TerminalReason = 'completed' | 'max_turns' | 'aborted' | 'content_filter' | 'model_error';
export type ContinueReason = 'next_turn' | 'compact_retry' | 'length_recovery';

export type TerminalDecision =
  | { type: 'continue'; reason: ContinueReason }
  | { type: 'terminal'; reason: TerminalReason; detail?: string };

export interface DecideTerminalInput {
  assistantContent: ContentBlock[];
  /** provider 归一化后的 finish.reason，仅作参考——不单独信任它来判定完成。 */
  finishReason: string;
  aborted: boolean;
  turnCount: number;
  maxTurns: number;
}

/**
 * §H 终止判定：只看"这一轮 assistant 消息是否含 tool_use 块"+
 * 异常 finish reason，**不信任** provider 的 `stop_reason` 单独作为
 * 完成信号（它并不总是可靠）。判定顺序：
 * aborted → content_filter → model_error → 有 tool_use → max_tokens
 * （截断续跑）→ 到达 maxTurns → 默认完成。
 */
export function decideTerminal(input: DecideTerminalInput): TerminalDecision {
  if (input.aborted) {
    return { type: 'terminal', reason: 'aborted' };
  }
  if (input.finishReason === 'content_filter') {
    return { type: 'terminal', reason: 'content_filter' };
  }
  if (input.finishReason === 'error') {
    return { type: 'terminal', reason: 'model_error' };
  }

  const hasToolUse = input.assistantContent.some((block) => block.type === 'tool_use');
  if (hasToolUse) {
    return { type: 'continue', reason: 'next_turn' };
  }

  if (input.finishReason === 'max_tokens') {
    return { type: 'continue', reason: 'length_recovery' };
  }

  if (input.turnCount >= input.maxTurns) {
    return { type: 'terminal', reason: 'max_turns' };
  }

  return { type: 'terminal', reason: 'completed' };
}
