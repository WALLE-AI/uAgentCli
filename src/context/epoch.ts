import type { Message } from '../types/message.js';

/**
 * §F Context Epoch：`baselineSeq` 标记压缩后的可见历史边界——
 * `baselineSeq` 之前的消息已被折叠进摘要，之后的消息原样保留。
 */
export interface ContextEpoch {
  baselineSeq: number;
}

export function initialEpoch(): ContextEpoch {
  return { baselineSeq: 0 };
}

export interface CompactEpochInput {
  epoch: ContextEpoch;
  messages: Message[];
  /** 替换 `< summaryMessage.seq` 区间的摘要消息，其 `seq` 即新的 baselineSeq。 */
  summaryMessage: Message;
}

export interface CompactEpochResult {
  epoch: ContextEpoch;
  messages: Message[];
}

/**
 * 原子替换被压区间：整个函数是纯函数，不原地修改传入的 `messages`——
 * 要么完整构造出新状态并返回，要么在校验失败时抛错、调用方持有的原
 * `messages` 引用完全不受影响，不存在"部分替换"的半态。
 */
export function compactEpoch(input: CompactEpochInput): CompactEpochResult {
  const { messages, summaryMessage } = input;

  const before = messages.filter((m) => m.seq < summaryMessage.seq);
  const after = messages.filter((m) => m.seq >= summaryMessage.seq);

  if (before.length === 0) {
    throw new Error('compactEpoch: no messages before summaryMessage.seq to compact');
  }

  return {
    epoch: { baselineSeq: summaryMessage.seq },
    messages: [summaryMessage, ...after],
  };
}

/** 装配时用于界定"可见历史"边界：只暴露 baselineSeq 及之后的消息。 */
export function visibleHistory(epoch: ContextEpoch, messages: Message[]): Message[] {
  return messages.filter((m) => m.seq >= epoch.baselineSeq);
}
