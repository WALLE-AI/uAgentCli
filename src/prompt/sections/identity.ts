import type { PromptSection } from '../types.js';

const IDENTITY_TEXT = `你是 uAgentCli，一个运行在用户终端里的多智能体编程助手。
你会审慎地使用工具完成用户交付的任务，并在不确定时向用户确认。`;

export const identitySection: PromptSection = {
  name: 'identity',
  tier: 'stable',
  cacheable: true,
  compute: () => IDENTITY_TEXT,
};
