import type { ContentBlock, Message } from '../types/message.js';

/**
 * §F 压缩阈值常量，移植自 OpenCode `session/compaction.ts`。
 */
export const PRUNE_MINIMUM = 20_000;
export const PRUNE_PROTECT = 40_000;
export const TOOL_OUTPUT_MAX_CHARS = 2_000;
export const PRUNE_PROTECTED_TOOLS = ['skill'];
export const DEFAULT_TAIL_TURNS = 2;

export interface PruneConfig {
  minimum?: number;
  protect?: number;
  tailTurns?: number;
  protectedTools?: string[];
}

export interface PruneResult {
  messages: Message[];
  prunedCount: number;
}

function estimateBlockChars(block: ContentBlock): number {
  if (block.type !== 'tool_result') {
    return 0;
  }
  return typeof block.content === 'string' ? block.content.length : JSON.stringify(block.content).length;
}

/**
 * 从后往前走：最近 `tailTurns` 轮（按 user 消息计数）永久受保护；再往前，
 * 对非受保护工具（`protectedTools`）的历史 tool_result 按字符数估算累加，
 * 超过 `protect` 阈值之后的部分才成为裁剪候选；只有当候选总量本身也超过
 * `minimum` 才真正裁剪——避免为了修剪一点点就打破缓存前缀。
 */
export function pruneToolOutputs(messages: Message[], config: PruneConfig = {}): PruneResult {
  const minimum = config.minimum ?? PRUNE_MINIMUM;
  const protect = config.protect ?? PRUNE_PROTECT;
  const tailTurns = config.tailTurns ?? DEFAULT_TAIL_TURNS;
  const protectedTools = new Set(config.protectedTools ?? PRUNE_PROTECTED_TOOLS);

  const toolNameById = new Map<string, string>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        toolNameById.set(block.id, block.name);
      }
    }
  }

  let turns = 0;
  let tailStartIndex = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      turns += 1;
      if (turns > tailTurns) {
        tailStartIndex = i + 1;
        break;
      }
    }
  }

  let accumulated = 0;
  const pruneCandidates = new Set<number>();
  for (let i = tailStartIndex - 1; i >= 0; i -= 1) {
    const message = messages[i];
    let hasEligible = false;
    let messageChars = 0;
    for (const block of message.content) {
      if (block.type !== 'tool_result') {
        continue;
      }
      const toolName = toolNameById.get(block.tool_use_id);
      if (toolName && protectedTools.has(toolName)) {
        continue;
      }
      hasEligible = true;
      messageChars += estimateBlockChars(block);
    }
    if (!hasEligible) {
      continue;
    }
    accumulated += messageChars;
    if (accumulated > protect) {
      pruneCandidates.add(i);
    }
  }

  const prunableChars = [...pruneCandidates].reduce((sum, i) => {
    return sum + messages[i].content.reduce((s, b) => s + estimateBlockChars(b), 0);
  }, 0);

  if (prunableChars < minimum) {
    return { messages, prunedCount: 0 };
  }

  const prunedMessages = messages.map((message, i) => {
    if (!pruneCandidates.has(i)) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((block): ContentBlock => {
        if (block.type !== 'tool_result') {
          return block;
        }
        const toolName = toolNameById.get(block.tool_use_id);
        if (toolName && protectedTools.has(toolName)) {
          return block;
        }
        return { ...block, content: '[pruned: output collapsed to save context]' };
      }),
    };
  });

  return { messages: prunedMessages, prunedCount: pruneCandidates.size };
}
