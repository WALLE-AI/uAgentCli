import type { Ruleset } from '../permission/types.js';

export type AgentMode = 'asTool' | 'teammate';
export type AgentSource = 'builtin' | 'user' | 'project' | 'flag';
export type AgentMemoryScope = 'user' | 'project' | 'local';

/**
 * 子智能体声明面。新增字段只需要在对应的 resolver
 * （见 `agent/resolvers.ts`）中处理，不需要改动其余 resolver。
 */
export interface AgentInfo {
  name: string;
  description: string;
  mode: AgentMode;
  source: AgentSource;
  /** markdown 正文，整体替换基础模板（非追加）。 */
  prompt: string;
  /** 语法糖：翻译成 permission 的 allow 规则。 */
  tools?: string[];
  permission?: Ruleset;
  /** 具体 model id，或 'inherit' 继承父 agent 的模型。 */
  model?: string | 'inherit';
  /** 声明后自动注入 read/write/edit，并隔离到对应命名空间目录。 */
  memory?: AgentMemoryScope;
  /** 预留字段，本阶段恒为 false。 */
  background?: boolean;
  /** 为 true 时跳过 AGENTS.md/CLAUDE.md 等项目文档注入。 */
  omitProjectDoc?: boolean;
  maxTurns?: number;
}
