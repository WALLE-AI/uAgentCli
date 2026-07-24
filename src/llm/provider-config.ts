import type { OpenAiQuirks } from './openai-compatible-provider.js';

/**
 * OpenAI 兼容族端点表：`llm/openai-compatible-provider.ts` 是唯一的映射
 * 实现，这里只参数化 baseURL/apiKey 环境变量名/quirks——新增一个兼容
 * 端点只需要加一条表项，不需要碰 provider 代码本身。
 */
export interface OpenAiEndpointConfig {
  baseURL?: string;
  /** 读取 API key 用的环境变量名（不在此处直接持有密钥值）。 */
  apiKeyEnvVar: string;
  quirks?: OpenAiQuirks;
}

export const OPENAI_COMPATIBLE_ENDPOINTS: Record<string, OpenAiEndpointConfig> = {
  openai: {
    apiKeyEnvVar: 'OPENAI_API_KEY',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
  },
  qwen: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnvVar: 'QWEN_API_KEY',
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    quirks: { omitStreamOptions: true },
  },
};

export interface ResolveEndpointOptions {
  /** 自定义端点（不在内置表中时的兜底，例如私有部署）。 */
  custom?: OpenAiEndpointConfig;
  env?: NodeJS.ProcessEnv;
}

/**
 * 按 endpoint 名查表；未命中内置表时回退 `options.custom`；两者都没有
 * 则抛明确错误（不做静默 fallback 到 openai 官方端点）。
 */
export function resolveOpenAiEndpoint(name: string, options: ResolveEndpointOptions = {}): OpenAiEndpointConfig {
  const config = OPENAI_COMPATIBLE_ENDPOINTS[name] ?? options.custom;
  if (!config) {
    throw new Error(`No OpenAI-compatible endpoint config for "${name}" (and no custom fallback provided).`);
  }
  return config;
}

export function readEndpointApiKey(config: OpenAiEndpointConfig, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[config.apiKeyEnvVar];
}
