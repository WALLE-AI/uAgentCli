import { z } from 'zod';

import type { SkillInfo } from '../../skill/types.js';
import type { ToolDef } from '../types.js';
import { loadToolPrompt } from '../prompts/load.js';

const paramsSchema = z.object({
  name: z.string().min(1),
});

type SkillParams = z.infer<typeof paramsSchema>;

/**
 * 渐进披露的"展开"一环：`discoverSkills()`/`formatSkills()` 只把
 * name/description/location 注入 system prompt，SKILL.md 正文要靠这个
 * 工具按需加载。未命中返回清晰提示（不抛错，允许模型据此自纠，而不是
 * 中断整轮）。
 */
export function createSkillTool(skills: SkillInfo[]): ToolDef<SkillParams> {
  return {
    id: 'skill',
    description: loadToolPrompt('skill'),
    parameters: paramsSchema,
    isReadOnly: true,
    isConcurrencySafe: true,
    isDestructive: false,
    execute: async (params) => {
      const skill = skills.find((s) => s.name === params.name);
      if (!skill) {
        const available = skills.map((s) => s.name).join(', ') || '(none discovered)';
        return { output: `Unknown skill "${params.name}". Available skills: ${available}` };
      }
      return { output: skill.content };
    },
  };
}
