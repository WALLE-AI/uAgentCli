import type { Action, Ruleset } from '../permission/types.js';
import type { ToolDef } from './types.js';

/**
 * 工具 id → 权限 Action 的映射，仅用于本迭代的简单 allow-list 过滤。
 * 真正的 last-match-wins 判定链在迭代2 `permission/evaluate.ts` 实现，
 * 届时 `getTools()` 的过滤逻辑会被替换为调用 evaluate()。
 */
export const TOOL_ACTION_MAP: Record<string, Action> = {
  read: 'read',
  write: 'write',
  edit: 'edit',
  bash: 'execute',
  skill: 'read',
  grep: 'read',
  glob: 'read',
  webfetch: 'read',
};

function isAllowed(def: ToolDef, ruleset: Ruleset): boolean {
  const action = TOOL_ACTION_MAP[def.id];
  if (!action) {
    return true;
  }
  const matching = ruleset.rules.filter(
    (rule) => rule.action === action && (rule.pattern === '*' || rule.pattern === def.id),
  );
  const last = matching[matching.length - 1];
  if (!last) {
    return true;
  }
  return last.decision !== 'deny';
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();

  /** 幂等：同 id 重复注册以最后一次为准，不抛错。 */
  register<Params>(def: ToolDef<Params>): void {
    this.tools.set(def.id, def as unknown as ToolDef);
  }

  get(id: string): ToolDef | undefined {
    return this.tools.get(id);
  }

  getTools(permCtx?: Ruleset): ToolDef[] {
    const all = [...this.tools.values()];
    if (!permCtx) {
      return all;
    }
    return all.filter((def) => isAllowed(def, permCtx));
  }
}
