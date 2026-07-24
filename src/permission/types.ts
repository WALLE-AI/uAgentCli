/**
 * 权限引擎基础类型（迭代0 占位，实现在迭代2 T2.1–T2.6）。
 * Ruleset 采用 last-match-wins 语义：evaluate() 从后往前找第一条
 * 匹配的 Rule，无匹配默认 ask。
 */

export type Action =
  | 'read'
  | 'write'
  | 'edit'
  | 'execute'
  | 'external_directory'
  | 'task'
  | 'todowrite';

export type Decision = 'allow' | 'deny' | 'ask';

export interface Rule {
  action: Action;
  /** glob 或工具名匹配模式，具体语法在迭代2 定义。 */
  pattern: string;
  decision: Decision;
}

export interface Ruleset {
  rules: Rule[];
}
