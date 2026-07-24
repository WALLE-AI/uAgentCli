import type { Action, Rule, Ruleset } from '../permission/types.js';
import type { AgentInfo } from './types.js';
import { deriveSubagentSessionPermission } from './subagent-permissions.js';

const TOOL_TO_ACTION: Record<string, Action> = {
  read: 'read',
  grep: 'read',
  glob: 'read',
  webfetch: 'read',
  skill: 'read',
  write: 'write',
  edit: 'edit',
  bash: 'execute',
  task: 'task',
  todowrite: 'todowrite',
};

const SUGAR_ACTIONS: Action[] = ['read', 'write', 'edit', 'execute'];

/**
 * `tools:[...]` 语法糖 → 翻译成 allow 规则 + 其余（`read/write/edit/execute`
 * 四个动作类别中未被授予的）deny 规则。未声明 `tools` 字段时不做任何限制
 * （返回空 Ruleset，交由上层决定默认策略）。
 */
export function resolveTools(agent: AgentInfo): Ruleset {
  if (!agent.tools) {
    return { rules: [] };
  }

  const granted = new Set<Action>();
  const rules: Rule[] = [];

  for (const toolName of agent.tools) {
    const action = TOOL_TO_ACTION[toolName] ?? 'execute';
    granted.add(action);
    rules.push({ action, pattern: toolName, decision: 'allow' });
  }

  for (const action of SUGAR_ACTIONS) {
    if (!granted.has(action)) {
      rules.push({ action, pattern: '*', decision: 'deny' });
    }
  }

  return { rules };
}

/** `model` 字段或 `'inherit'` → 具体 model id；未声明时回退到 defaultModel。 */
export function resolveModel(agent: AgentInfo, defaultModel: string): string {
  if (!agent.model || agent.model === 'inherit') {
    return defaultModel;
  }
  return agent.model;
}

/** markdown 正文整体替换基础模板（非追加）。 */
export function resolvePrompt(agent: AgentInfo): string {
  return agent.prompt;
}

/**
 * 合并 `tools` 语法糖翻译结果、agent 自身显式声明的 permission、
 * 以及从父会话继承的子权限（deny-only 语义，见 subagent-permissions.ts）。
 */
export function resolvePermission(agent: AgentInfo, parentPermission: Ruleset): Ruleset {
  const fromTools = resolveTools(agent);
  const explicit = agent.permission?.rules ?? [];
  const inherited = deriveSubagentSessionPermission(parentPermission, agent);

  return {
    rules: [...fromTools.rules, ...explicit, ...inherited.rules],
  };
}
