import type { z } from 'zod';
import type { RunContext } from '../types/abort.js';

export interface ToolResult {
  output: string;
  truncated?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * §J 工具契约。布尔标记全部默认 fail-closed：未声明的工具被当作
 * "有副作用、不可并发、破坏性"处理，宁可少并发/多确认，也不静默放行。
 */
export interface ToolDef<Params = unknown> {
  id: string;
  description: string;
  parameters: z.ZodType<Params>;
  execute: (params: Params, ctx: RunContext) => Promise<ToolResult>;
  /** 默认 false：未声明视为有副作用。 */
  isReadOnly?: boolean;
  /** 默认 false：未声明视为不可与其他调用并发。 */
  isConcurrencySafe?: boolean;
  /** 默认 true：未声明视为破坏性操作。 */
  isDestructive?: boolean;
  /** 输出来自不可信外部数据（网页/命令输出），需要围栏包裹。 */
  untrustedOutput?: boolean;
}

export class InvalidArgumentsError extends Error {
  constructor(
    public readonly toolId: string,
    public readonly issues: unknown,
  ) {
    super(`Invalid arguments for tool "${toolId}"`);
    this.name = 'InvalidArgumentsError';
  }
}
