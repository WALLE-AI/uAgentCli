/**
 * 上下文装配基础类型（迭代0 占位，实现在迭代1 T1.1/迭代3 T3.6）。
 * 仅保证后续模块可引用而不产生循环依赖。
 */

export type PromptTier = 'stable' | 'context' | 'volatile';

export interface ContextSection {
  name: string;
  tier: PromptTier;
  cacheable: boolean;
}
