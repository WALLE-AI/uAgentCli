import { selectModelVariant } from '../prompt/system-prompt.js';
import type { LlmProvider } from './types.js';

export interface ProviderRegistry {
  getProvider(modelId: string): LlmProvider;
}

/**
 * 按 `selectModelVariant`（迭代1 `prompt/system-prompt.ts`，与 prompt 模板
 * 选择复用同一套路由判断）路由到已注册的 provider。未注册的 provider
 * family 抛明确错误，不做静默 fallback。
 */
export function createProviderRegistry(providers: Partial<Record<'anthropic' | 'openai' | 'default', LlmProvider>>): ProviderRegistry {
  return {
    getProvider(modelId: string): LlmProvider {
      const variant = selectModelVariant(modelId);
      const provider = providers[variant];
      if (!provider) {
        throw new Error(`No LLM provider registered for model family "${variant}" (model id: "${modelId}")`);
      }
      return provider;
    },
  };
}
