import type { Action, Decision, Ruleset } from './types.js';
import { findRule } from './evaluate.js';
import { isBypassModeEnabled, resolveBypassDecision, type BypassClassifier, type PermissionMode } from './mode.js';

export interface GateInput {
  action: Action;
  pattern: string;
  mode: PermissionMode;
  /** 会话/agent 组合出的完整 ruleset（含 deny/ask/allow）。 */
  ruleset: Ruleset;
  /** `reply always` 运行时累积的规则（步骤8）。 */
  approved: Ruleset;
  /** risk.ts `detectHardline()` 命中——绝对拒绝，不进入 ask 队列，不受任何模式影响。 */
  hardline?: boolean;
  /** 工具自身的判定逻辑（步骤3）。 */
  toolCheck?: () => Decision | undefined;
  /** 工具声明必须人工交互（步骤4）。 */
  requiresUserInteraction?: boolean;
  /** 内容级 ask，如 boundary 越界 / `.env` 读取（步骤5）。 */
  contentAsk?: boolean;
  /** safetyCheck 命中，如危险路径删除（步骤6）。 */
  safetyCheck?: boolean;
  classifier?: BypassClassifier;
}

/**
 * §四 主 agent 有序判定链。步骤 1–6 对任何权限模式（含 bypass/yolo）
 * 都无条件生效——只有走到步骤7 才会被模式影响。`dontAsk` 模式下任何
 * 最终落到 `ask` 的结果都会被 fail-closed 降级为 `deny`（无人值守场景
 * 没有人能回答 ask）。
 */
export function checkToolPermission(input: GateInput): Decision {
  // 步骤0（risk.ts 硬线）：bypass-immune，比规则匹配更早，任何模式下都拒绝。
  if (input.hardline) {
    return finalize(input.mode, 'deny');
  }

  // 步骤1/2：ruleset 显式命中 deny/ask 立即停止；显式 allow 或无匹配则继续走安全网。
  const explicit = findRule(input.action, input.pattern, input.ruleset);
  if (explicit?.decision === 'deny') {
    return finalize(input.mode, 'deny');
  }
  if (explicit?.decision === 'ask') {
    return finalize(input.mode, 'ask');
  }

  // 步骤3：工具自判。
  const toolDecision = input.toolCheck?.();
  if (toolDecision === 'deny' || toolDecision === 'ask') {
    return finalize(input.mode, toolDecision);
  }

  // 步骤4：工具声明必须人工交互。
  if (input.requiresUserInteraction) {
    return finalize(input.mode, 'ask');
  }

  // 步骤5：内容级 ask。
  if (input.contentAsk) {
    return finalize(input.mode, 'ask');
  }

  // 步骤6：safetyCheck。
  if (input.safetyCheck) {
    return finalize(input.mode, 'ask');
  }

  // 步骤7：bypass/yolo 模式放行（仅此步起受模式影响）。
  if (isBypassModeEnabled(input.mode)) {
    const bypassDecision = resolveBypassDecision(input.mode, input.classifier);
    if (bypassDecision === 'allow') {
      return 'allow';
    }
  }

  // 步骤8：alwaysAllow 运行时累积规则。
  const always = findRule(input.action, input.pattern, input.approved);
  if (always?.decision === 'allow') {
    return 'allow';
  }

  // 步骤9：默认——显式 allow 规则放行；否则 ask。
  return finalize(input.mode, explicit?.decision === 'allow' ? 'allow' : 'ask');
}

/** `dontAsk`（无人值守）模式下，任何落到 ask 的结果都 fail-closed 降级为 deny。 */
function finalize(mode: PermissionMode, decision: Decision): Decision {
  if (mode === 'dontAsk' && decision === 'ask') {
    return 'deny';
  }
  return decision;
}
