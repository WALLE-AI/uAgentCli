import type { Ruleset } from '../permission/types.js';
import type { AgentInfo } from './types.js';

/**
 * 移植自 OpenCode `agent/subagent-permissions.ts`：子会话的权限只保留父会话的
 * deny 规则与 external_directory 规则（无论 action），剥除所有 allow 规则；
 * 再强制追加 todowrite/task 的 deny，除非子 agent 自身声明显式 allow。
 *
 * 这是纯粹的数据结构变换（shape），语义上"子权限确实 deny-only"依赖
 * 迭代2 的 `evaluate()`（last-match-wins），本迭代只做结构层单测。
 */
export function deriveSubagentSessionPermission(
  parentPermission: Ruleset,
  subagent: AgentInfo,
): Ruleset {
  const subagentRules = subagent.permission?.rules ?? [];
  const canTask = subagentRules.some((rule) => rule.action === 'task' && rule.decision === 'allow');
  const canTodo = subagentRules.some(
    (rule) => rule.action === 'todowrite' && rule.decision === 'allow',
  );

  const inherited = parentPermission.rules.filter(
    (rule) => rule.action === 'external_directory' || rule.decision === 'deny',
  );

  return {
    rules: [
      ...inherited,
      ...(canTodo ? [] : [{ action: 'todowrite' as const, pattern: '*', decision: 'deny' as const }]),
      ...(canTask ? [] : [{ action: 'task' as const, pattern: '*', decision: 'deny' as const }]),
    ],
  };
}
