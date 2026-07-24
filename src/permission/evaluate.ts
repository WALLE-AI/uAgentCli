import type { Action, Rule, Ruleset } from './types.js';
import { globMatch } from './glob.js';

const DEFAULT_ASK: Rule = { action: 'read', pattern: '*', decision: 'ask' };

/**
 * last-match-wins 的核心查找，不带默认值：从后往前找第一条同时匹配
 * action 与 pattern 的规则，找不到返回 `undefined`（区别于"显式 ask
 * 规则"，供 `gate.ts` 判断是否属于步骤1/2 的显式命中）。
 */
export function findRule(action: Action, pattern: string, ...rulesets: Ruleset[]): Rule | undefined {
  const allRules = rulesets.flatMap((r) => r.rules);
  for (let i = allRules.length - 1; i >= 0; i -= 1) {
    const rule = allRules[i];
    if (rule.action === action && globMatch(pattern, rule.pattern)) {
      return rule;
    }
  }
  return undefined;
}

/**
 * last-match-wins：把多个 ruleset 拼接成一条线性规则序列，从后往前找
 * 第一条同时匹配 action 与 pattern 的规则。无匹配时默认 `ask`
 * （fail-closed：宁可多问一次，不静默放行）。
 *
 * 传入顺序即优先级顺序——后面的 ruleset 整体覆盖前面的（例如
 * `evaluate(action, pattern, parentRuleset, sessionRuleset)` 中
 * sessionRuleset 优先于 parentRuleset）。
 */
export function evaluate(action: Action, pattern: string, ...rulesets: Ruleset[]): Rule {
  return findRule(action, pattern, ...rulesets) ?? { ...DEFAULT_ASK, action, pattern };
}
