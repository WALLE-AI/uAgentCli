import { describe, it, expect } from 'vitest';
import type { Message } from '../../src/types/message.js';
import { selectProtectedTail } from '../../src/context/tail.js';

function user(seq: number, text = 'u'): Message {
  return { role: 'user', content: [{ type: 'text', text }], seq };
}
function assistant(seq: number, text = 'a'): Message {
  return { role: 'assistant', content: [{ type: 'text', text }], seq };
}

describe('M0.4 selectProtectedTail', () => {
  it('空历史 → {0,0}', () => {
    expect(selectProtectedTail([])).toEqual({ tailStartIndex: 0, tailStartSeq: 0 });
  });

  it('少于 tailTurns 轮 → 全部受保护（index 0）', () => {
    const msgs = [user(0), assistant(1)];
    expect(selectProtectedTail(msgs, { tailTurns: 2 }).tailStartIndex).toBe(0);
  });

  it('边界落在第 (tailTurns+1) 个 user-from-end 之后（与 prune 计数一致）', () => {
    // u0 a1 u2 a3 u4 a5 u6 a7；users@0,2,4,6；tailTurns=2
    const msgs = [user(0), assistant(1), user(2), assistant(3), user(4), assistant(5), user(6), assistant(7)];
    const { tailStartIndex, tailStartSeq } = selectProtectedTail(msgs, { tailTurns: 2 });
    // 从末尾数第 3 个 user 是 u2(idx2)，turns=3>2 → tailStartIndex=idx2+1=3 (a3)
    expect(tailStartIndex).toBe(3);
    expect(tailStartSeq).toBe(3);
  });

  it('配对不拆断：tail 首条为引用 head tool_use 的孤儿 tool_result → 边界前移', () => {
    // u0(prompt) a1(tool_use X) u2(prompt2) u3(tool_result X→idx1) a4
    const msgs: Message[] = [
      user(0),
      { role: 'assistant', content: [{ type: 'tool_use', id: 'X', name: 'bash', input: {} }], seq: 1 },
      user(2, 'prompt2'),
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'X', content: 'ok' }], seq: 3 },
      assistant(4),
    ];
    // users@0,2,3；tailTurns=1：从末尾 i4 a; i3 user t1; i2 user t2>1 → raw tailStartIndex=3 (孤儿 tool_result)
    // 修复：idx3 引用 idx1 的 X → 前移到 idx2（u2 prompt2，无 tool_result）
    const { tailStartIndex } = selectProtectedTail(msgs, { tailTurns: 1 });
    expect(tailStartIndex).toBe(2);
  });

  it('repairPairing:false 保留原始逐 user 计数（不前移）', () => {
    const msgs: Message[] = [
      user(0),
      { role: 'assistant', content: [{ type: 'tool_use', id: 'X', name: 'bash', input: {} }], seq: 1 },
      user(2, 'prompt2'),
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'X', content: 'ok' }], seq: 3 },
      assistant(4),
    ];
    const { tailStartIndex } = selectProtectedTail(msgs, { tailTurns: 1, repairPairing: false });
    expect(tailStartIndex).toBe(3); // 不修复，停在孤儿 tool_result
  });
});
