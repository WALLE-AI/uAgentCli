import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { PromptSection } from './types.js';
import { identitySection } from './sections/identity.js';
import { toolPolicySection } from './sections/tool-policy.js';
import { skillsVerboseSection } from './sections/skills-verbose.js';
import { environmentSection } from './sections/environment.js';
import { memorySnapshotSection } from './sections/memory-snapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_VARIANTS_DIR = path.join(__dirname, 'model-variants');

export type ModelVariant = 'anthropic' | 'openai' | 'default';

/**
 * 按 model.id 子串匹配选模板：claude/anthropic → anthropic.txt，
 * gpt/openai/deepseek/qwen/openrouter → openai.txt（整个兼容族共用），
 * 其余 → default.txt。
 */
export function selectModelVariant(modelId: string): ModelVariant {
  const id = modelId.toLowerCase();
  if (id.includes('claude') || id.includes('anthropic')) {
    return 'anthropic';
  }
  if (
    id.includes('gpt') ||
    id.includes('openai') ||
    id.includes('deepseek') ||
    id.includes('qwen') ||
    id.includes('openrouter')
  ) {
    return 'openai';
  }
  return 'default';
}

function loadModelVariantTemplate(variant: ModelVariant): string {
  const file = path.join(MODEL_VARIANTS_DIR, `${variant}.txt`);
  return readFileSync(file, 'utf-8').trimEnd();
}

/** 固定装配顺序：stable(identity/tool-policy/skills-verbose) → volatile(env/memory-snapshot)。 */
const FIXED_SECTION_ORDER: PromptSection[] = [
  identitySection,
  toolPolicySection,
  skillsVerboseSection,
  environmentSection,
  memorySnapshotSection,
];

export interface BuildSystemPromptInput {
  model: { id: string };
  /** agent 声明的 markdown 正文（若有）。 */
  agentPrompt?: string;
  /** 用户/项目自定义模板文本（若有）。 */
  customTemplate?: string;
  /** 显式覆盖，最高优先级。 */
  override?: string;
}

/**
 * 纯函数：相同输入产出字节相同输出。优先级 override > agentPrompt >
 * customTemplate > 按 model.id 选中的默认模板。
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const basePrompt =
    input.override ??
    input.agentPrompt ??
    input.customTemplate ??
    loadModelVariantTemplate(selectModelVariant(input.model.id));

  const blocks = [basePrompt, ...FIXED_SECTION_ORDER.map((section) => section.compute())];
  return blocks.join('\n\n');
}

export { FIXED_SECTION_ORDER };
