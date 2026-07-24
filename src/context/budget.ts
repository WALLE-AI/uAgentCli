import type { ContentBlock, Message } from '../types/message.js';
import { pruneToolOutputs, TOOL_OUTPUT_MAX_CHARS, type PruneConfig, type PruneResult } from './prune.js';

export const COMPACTION_BUFFER = 20_000;

export interface BudgetConfig {
  reservedTokens?: number;
  autoCompactEnabled?: boolean;
}

/** 可用于装配历史的 token 预算：contextLimit 减去为输出保留的部分。 */
export function usableTokens(contextLimit: number, maxOutputTokens: number, config: BudgetConfig = {}): number {
  const reserved = config.reservedTokens ?? Math.min(COMPACTION_BUFFER, maxOutputTokens);
  return Math.max(0, contextLimit - reserved);
}

export interface OverflowInput {
  totalTokens: number;
  contextLimit: number;
  maxOutputTokens: number;
  config?: BudgetConfig;
}

export function isOverflow(input: OverflowInput): boolean {
  if (input.config?.autoCompactEnabled === false) {
    return false;
  }
  if (input.contextLimit === 0) {
    return false;
  }
  return input.totalTokens >= usableTokens(input.contextLimit, input.maxOutputTokens, input.config);
}

function truncateBlock(block: ContentBlock, maxChars: number): ContentBlock {
  if (block.type !== 'tool_result' || typeof block.content !== 'string') {
    return block;
  }
  if (block.content.length <= maxChars) {
    return block;
  }
  return { ...block, content: `${block.content.slice(0, maxChars)}\n[truncated: exceeded ${maxChars} chars]` };
}

/** 阶段1：对每条 tool_result 单独设置字符上限（软截断，保留大部分内容）。 */
export function applyToolResultBudget(messages: Message[], maxChars: number = TOOL_OUTPUT_MAX_CHARS): Message[] {
  return messages.map((message) => ({
    ...message,
    content: message.content.map((block) => truncateBlock(block, maxChars)),
  }));
}

/** 阶段2：任意字符串按 head+tail 保留，中间省略——用于单个字段级裁剪。 */
export function snip(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const head = Math.ceil(maxLength * 0.7);
  const tail = maxLength - head;
  return `${text.slice(0, head)}\n...[snipped]...\n${text.slice(text.length - tail)}`;
}

/** 阶段3：单条 tool_result 远超阈值时硬折叠为一行占位（比 applyToolResultBudget 更激进）。 */
export function microcompact(messages: Message[], thresholdChars: number): Message[] {
  return messages.map((message) => ({
    ...message,
    content: message.content.map((block): ContentBlock => {
      if (block.type !== 'tool_result' || typeof block.content !== 'string') {
        return block;
      }
      if (block.content.length <= thresholdChars) {
        return block;
      }
      return { ...block, content: `[microcompacted: ${block.content.length} chars collapsed]` };
    }),
  }));
}

/** 阶段4：跨消息级别的历史 tool_result 修剪，移植自 prune.ts 的算法。 */
export function contextCollapse(messages: Message[], config: PruneConfig = {}): PruneResult {
  return pruneToolOutputs(messages, config);
}

/** 阶段5：是否应该触发一次真正的（LLM 摘要式）自动压缩。 */
export function autoCompactDecision(input: OverflowInput): 'skip' | 'compact' {
  return isOverflow(input) ? 'compact' : 'skip';
}
