import type { Hook, HookContext, HookEvent, HookPermissionDecision, HookResult } from './types.js';

const DECISION_RANK: Record<HookPermissionDecision, number> = { deny: 2, ask: 1, allow: 0 };

/** 合并多个 hook 的 permissionDecision：最严格优先（deny > ask > allow），未声明的忽略。 */
function mergeDecisions(results: HookResult[]): HookResult {
  let merged: HookPermissionDecision | undefined;
  for (const result of results) {
    if (!result.permissionDecision) {
      continue;
    }
    if (!merged || DECISION_RANK[result.permissionDecision] > DECISION_RANK[merged]) {
      merged = result.permissionDecision;
    }
  }
  return merged ? { permissionDecision: merged } : {};
}

/**
 * `register()`/`list()` 是真实行为；`run()` 是真正的执行管线——按注册顺序
 * 跑一遍 `ctx.event` 下所有 hook，合并它们的 `permissionDecision`。**不**
 * 接入 `permission/gate.ts`（`checkToolPermission()` 签名不带 hooks 参数，
 * 依旧是唯一判定源）；真正的调用点在 `core/run-loop.ts`，由调用方决定如何
 * 使用这个合并结果（收紧已有判定，而不是替换判定链）。
 */
export class HookRegistry {
  private readonly hooks: Hook[] = [];

  register(hook: Hook): void {
    this.hooks.push(hook);
  }

  list(event: HookEvent): Hook[] {
    return this.hooks.filter((h) => h.event === event);
  }

  async run(ctx: HookContext): Promise<HookResult> {
    const results: HookResult[] = [];
    for (const hook of this.list(ctx.event)) {
      results.push(await hook.handle(ctx));
    }
    return mergeDecisions(results);
  }
}

export type { Hook, HookContext, HookEvent, HookResult };
