import type { Rule } from './types.js';
import { evaluate } from './evaluate.js';
import type { PermissionManager } from './manager.js';

export type ReplyKind = 'once' | 'always' | 'reject';

export interface ReplyInput {
  requestID: string;
  reply: ReplyKind;
  /** `always` 时要持久化为 allow 的 pattern；缺省时退化为 request.patterns。 */
  always?: string[];
}

export interface ApprovedStore {
  rules: Rule[];
}

/**
 * reply 语义：
 * - `once`：放行本次调用，不写入 approved，不影响其他 pending。
 * - `always`：放行本次调用 + 把规则推入运行时 approved（内存，落盘是
 *   T2.6 persist.ts 的职责）+ 级联重评估同 session 其余 pending——凡是
 *   其所有 pattern 在追加 approved 后都变为 allow 的，自动一并放行。
 * - `reject`：拒绝本次调用 + 级联拒绝同 session 其余全部 pending。
 *
 * 请求已不存在（重复 reply / 已被其他通道 settle）时整体是 no-op。
 */
export function handleReply(
  manager: PermissionManager,
  approvedStore: ApprovedStore,
  input: ReplyInput,
): void {
  const info = manager.peek(input.requestID);
  if (!info) {
    return;
  }

  if (input.reply === 'reject') {
    manager.settle(input.requestID, 'deny');
    for (const pending of manager.listPending(info.sessionID)) {
      manager.settle(pending.id, 'deny');
    }
    return;
  }

  manager.settle(input.requestID, 'allow');

  if (input.reply === 'always') {
    const patterns = input.always ?? info.patterns;
    for (const pattern of patterns) {
      approvedStore.rules.push({ action: info.action, pattern, decision: 'allow' });
    }

    for (const pending of manager.listPending(info.sessionID)) {
      const fullyApproved = pending.patterns.every(
        (pattern) => evaluate(pending.action, pattern, { rules: approvedStore.rules }).decision === 'allow',
      );
      if (fullyApproved) {
        manager.settle(pending.id, 'allow');
      }
    }
  }
}
