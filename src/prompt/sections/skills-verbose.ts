import type { PromptSection } from '../types.js';

/**
 * 本迭代无真实技能池扫描（迭代3 T3.7 实现），先给空列表占位。
 */
function computeSkillsVerbose(): string {
  return ['<skills>', '(no skills discovered)', '</skills>'].join('\n');
}

export const skillsVerboseSection: PromptSection = {
  name: 'skills-verbose',
  tier: 'stable',
  cacheable: true,
  compute: computeSkillsVerbose,
};
