/**
 * §B AbortSignal 载体：逐层穿透取消信号的唯一入参形状。
 * 任何后续函数（provider streamChat、tool 编排、exec-gateway、
 * subprocess kill）都应以 RunContext 为取消/转向语义的单一来源，
 * 不允许"事后加取消"。
 */

import type { SessionID } from './ids.js';

/**
 * 占位接口：具体权限上下文形状随 `permission/types.ts`（T0.5）
 * 及后续迭代（权限引擎）细化，此处只保证 RunContext 的字段存在。
 */
export interface PermissionContext {
  mode: string;
  sessionID: SessionID;
}

export interface RunContext {
  signal: AbortSignal;
  sessionID: SessionID;
  /** 子智能体递归深度，0 为主 agent。 */
  depth: number;
  permission: PermissionContext;
}
