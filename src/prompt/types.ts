/**
 * Prompt section 类型：system prompt 由若干具名 section 按固定顺序拼装。
 * `compute()` 必须是纯函数——相同输入（含隐式的"当前时钟/环境"输入）
 * 产出字节相同的输出，否则会打破 Anthropic 的 cache_control 前缀缓存。
 */

export type PromptTier = 'stable' | 'context' | 'volatile';

export interface PromptSection {
  name: string;
  tier: PromptTier;
  cacheable: boolean;
  compute: () => string;
}
