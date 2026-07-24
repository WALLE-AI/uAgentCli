import type { ContentBlock, Message } from '../types/message.js';

export type CountTokensFn = (message: Message) => number;

function blockToText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'thinking':
      return block.thinking;
    case 'tool_use':
      return JSON.stringify(block.input);
    case 'tool_result':
      return typeof block.content === 'string' ? block.content : block.content.map(blockToText).join(' ');
    case 'image':
      return '';
  }
}

/** 本地估算兜底：粗略按字符数/4 近似（不追求精确，只求确定性、零依赖）。 */
export function localEstimate(message: Message): number {
  const text = message.content.map(blockToText).join(' ');
  return Math.ceil(text.length / 4);
}

/**
 * §E 统一 token 计数口径：生产环境注入 Anthropic `countTokens` API，
 * 不可用（未注入/调用失败）时降级本地估算。**按 `message.seq` 缓存**，
 * 同 seq 命中缓存不重算——`seq` 不变即消息内容不变（历史消息只追加，
 * 不原地修改）。
 */
export class TokenCounter {
  private readonly cache = new Map<number, number>();

  constructor(private readonly countFn: CountTokensFn = localEstimate) {}

  count(message: Message): number {
    const cached = this.cache.get(message.seq);
    if (cached !== undefined) {
      return cached;
    }

    let tokens: number;
    try {
      tokens = this.countFn(message);
    } catch {
      tokens = localEstimate(message);
    }

    this.cache.set(message.seq, tokens);
    return tokens;
  }

  invalidate(seq: number): void {
    this.cache.delete(seq);
  }

  clear(): void {
    this.cache.clear();
  }
}
