import type { PromptSection } from '../types.js';

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function computeEnvironment(): string {
  const lines = [
    '<env>',
    `cwd: ${process.cwd()}`,
    `platform: ${process.platform}`,
    `date: ${todayISODate()}`,
    '</env>',
  ];
  return lines.join('\n');
}

export const environmentSection: PromptSection = {
  name: 'environment',
  tier: 'volatile',
  cacheable: false,
  compute: computeEnvironment,
};
