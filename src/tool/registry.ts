import type { Action, Ruleset } from '../permission/types.js';
import { evaluate } from '../permission/evaluate.js';
import type { ToolDef } from './types.js';

/**
 * 工具 id → 权限 Action 的映射。这是纯粹的**声明映射**（哪个工具属于哪类
 * 动作），不是判定逻辑——判定统一走 `permission/evaluate.ts` 的 last-match-wins
 * 判定链（T7.2：消除 registry 自带的第二套 last-match 实现，避免语义漂移）。
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

/**
 * 工具是否对当前 ruleset 可见：以工具 id 为 pattern 跑 `evaluate()`，
 * 判定为 `deny` 即隐藏。无匹配规则时 evaluate 返回默认 `ask`（非 deny）→ 可见。
 */
function isAllowed(def: ToolDef, ruleset: Ruleset): boolean {
  const action = TOOL_ACTION_MAP[def.id];
  if (!action) {
    return true;
  }
  return evaluate(action, def.id, ruleset).decision !== 'deny';
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
