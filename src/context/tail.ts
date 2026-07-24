import type { Message } from '../types/message.js';
import { DEFAULT_TAIL_TURNS } from './prune.js';

/**
 * M0.4 · 受保护 tail 选择器。
 *
 * 从后往前按 user 消息计数最近 `tailTurns` 轮，产出 tail 起点。摘要（A/T11.1）
 * 只把 head 交 LLM、tail 逐字保留；reclaim（E/T11.5）保护 tail 不折叠。二者
 * 共用本函数，避免各判各的 tail 边界导致不一致。
 *
 * **配对不拆断**：Anthropic 硬约束——tail 首条不能是引用了 head 中 tool_use 的
 * 孤儿 tool_result（否则 400）。若边界落在这种消息上，回退把对应 assistant
 * 一并纳入 tail。
 */

export interface ProtectedTail {
  /** 第一条受保护（tail）消息的下标。全部受保护时为 0。 */
  tailStartIndex: number;
  /** 该消息的 seq（compactEpoch 的 baseline 前移到此）。空历史为 0。 */
  tailStartSeq: number;
}

export interface SelectTailOptions {
  tailTurns?: number;
  /** 关闭配对修复（prune 若要保持原始逐 user 计数可传 false）。默认 true。 */
  repairPairing?: boolean;
}

export function selectProtectedTail(messages: Message[], options: SelectTailOptions = {}): ProtectedTail {
  const tailTurns = options.tailTurns ?? DEFAULT_TAIL_TURNS;
  const repairPairing = options.repairPairing ?? true;

  if (messages.length === 0) {
    return { tailStartIndex: 0, tailStartSeq: 0 };
  }

  // 按 user 消息计数轮次：超过 tailTurns 的那条 user 之后即 tail 起点。
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

  if (repairPairing && tailStartIndex > 0) {
    // tool_use_id → 所在消息下标
    const toolUseIndex = new Map<string, number>();
    for (let i = 0; i < messages.length; i += 1) {
      for (const block of messages[i].content) {
        if (block.type === 'tool_use') {
          toolUseIndex.set(block.id, i);
        }
      }
    }
    // 若 tail 首条引用了更早（head）的 tool_use，则把边界前移纳入那条 assistant。
    while (tailStartIndex > 0) {
      const first = messages[tailStartIndex];
      const orphan = first.content.some((b) => {
        if (b.type !== 'tool_result') return false;
        const owner = toolUseIndex.get(b.tool_use_id);
        return owner !== undefined && owner < tailStartIndex;
      });
      if (!orphan) break;
      tailStartIndex -= 1;
    }
  }

  return { tailStartIndex, tailStartSeq: messages[tailStartIndex]?.seq ?? 0 };
}
