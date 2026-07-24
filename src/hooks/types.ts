/**
 * Hooks 安全 interposition 占位（§L）：只留事件枚举 + `permissionDecision`
 * 契约，不接入 run-loop 判定链路——`permission/gate.ts` 的
 * `checkToolPermission()` 在本迭代仍是唯一判定源，hooks 注册与否都不
 * 改变它的行为。真正的执行管线（在 gate 前/后插入 hook 调用）延后。
 */
export type HookEvent = 'PreToolUse' | 'PostToolUse';
export type HookPermissionDecision = 'allow' | 'deny' | 'ask';

export interface HookContext {
  event: HookEvent;
  toolId: string;
  sessionID: string;
}

export interface HookResult {
  permissionDecision?: HookPermissionDecision;
}

export interface Hook {
  event: HookEvent;
  handle(ctx: HookContext): Promise<HookResult> | HookResult;
}
