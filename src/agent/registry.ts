import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { AgentInfo, AgentSource } from './types.js';
import { loadAgentsFromMarkdown, type FsLike } from './loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_PROMPTS_DIR = path.join(__dirname, '..', 'prompt', 'agent-prompts');

function loadAgentPrompt(name: string): string {
  return readFileSync(path.join(AGENT_PROMPTS_DIR, `${name}.txt`), 'utf-8').trim();
}

/**
 * 内置 agent 定义。所有子 agent 角色（build 除外）物理排除 `task` 工具
 * 本身，防止在注册层面就能递归拉起子 agent，而不是仅靠运行时权限检查。
 */
export function createBuiltinAgents(): AgentInfo[] {
  return [
    {
      name: 'build',
      description: '主 agent：完整工具集与默认权限，负责端到端完成用户请求。',
      mode: 'asTool',
      source: 'builtin',
      prompt: loadAgentPrompt('general'),
      background: false,
    },
    {
      name: 'plan',
      description: '规划 agent：先探索后设计，只能写入 .uagent/plans/*.md。',
      mode: 'asTool',
      source: 'builtin',
      prompt: loadAgentPrompt('plan'),
      permission: {
        rules: [
          { action: 'write', pattern: '.uagent/plans/*.md', decision: 'allow' },
          { action: 'write', pattern: '*', decision: 'deny' },
          { action: 'edit', pattern: '.uagent/plans/*.md', decision: 'allow' },
          { action: 'edit', pattern: '*', decision: 'deny' },
        ],
      },
      background: false,
    },
    {
      name: 'general',
      description: '通用子 agent：除 todowrite 外的全部工具，用于多步委派任务。',
      mode: 'asTool',
      source: 'builtin',
      prompt: loadAgentPrompt('general'),
      tools: ['read', 'write', 'edit', 'bash', 'grep', 'glob', 'webfetch'],
      background: false,
    },
    {
      name: 'explore',
      description: '只读探索子 agent：定位代码/信息，不能写入或递归委派。',
      mode: 'asTool',
      source: 'builtin',
      prompt: loadAgentPrompt('explore'),
      tools: ['read', 'grep', 'glob', 'webfetch'],
      background: false,
    },
    {
      name: 'compactor',
      description: '内部角色：压缩会话历史，零工具。',
      mode: 'asTool',
      source: 'builtin',
      prompt: loadAgentPrompt('compaction'),
      tools: [],
      background: false,
    },
    {
      name: 'memory-extractor',
      description: '内部角色：从会话历史抽取长期记忆，零工具（迭代5 实现调用链路）。',
      mode: 'asTool',
      source: 'builtin',
      prompt: '你负责从会话历史中抽取值得长期保存的记忆条目，不使用任何工具，只输出抽取结果。',
      tools: [],
      background: false,
    },
  ];
}

export interface RegisterOptions {
  userDir: string;
  projectDir: string;
  fs?: FsLike;
  /** 命令行 --agent 传入的一次性覆盖，优先级最高。 */
  flagAgents?: AgentInfo[];
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentInfo>();

  constructor(options: RegisterOptions) {
    for (const agent of createBuiltinAgents()) {
      this.agents.set(agent.name, agent);
    }

    const { agents: fileAgents } = loadAgentsFromMarkdown(
      [
        { source: 'user', dir: path.join(options.userDir, '.uagent', 'agents') },
        { source: 'project', dir: path.join(options.projectDir, '.uagent', 'agents') },
      ],
      options.fs,
    );
    for (const agent of fileAgents) {
      this.agents.set(agent.name, agent);
    }

    for (const agent of options.flagAgents ?? []) {
      this.agents.set(agent.name, { ...agent, source: 'flag' as AgentSource });
    }
  }

  get(name: string): AgentInfo | undefined {
    return this.agents.get(name);
  }

  list(): AgentInfo[] {
    return [...this.agents.values()];
  }
}
