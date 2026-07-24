import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AgentInfo, AgentMemoryScope } from '../agent/types.js';
import type { Rule } from '../permission/types.js';

export interface AgentMemoryFsLike {
  existsSync(target: string): boolean;
  readFileSync(target: string, encoding: 'utf-8'): string;
  writeFileSync(target: string, data: string, encoding: 'utf-8'): void;
  mkdirSync(target: string, options?: { recursive?: boolean }): unknown;
}

const DEFAULT_FS: AgentMemoryFsLike = { existsSync, readFileSync, writeFileSync, mkdirSync };

export interface AgentMemoryRoots {
  homeDir: string;
  projectRoot: string;
}

/**
 * 按 `AgentInfo.memory` 的 scope 决定根目录，不同 agentName 物理路径
 * 隔离：`<root>/agent-memory/<agentName>/MEMORY.md`。
 */
export function resolveAgentMemoryPath(
  agentName: string,
  scope: AgentMemoryScope,
  roots: AgentMemoryRoots,
): string {
  if (scope === 'user') {
    return path.join(roots.homeDir, 'agent-memory', agentName, 'MEMORY.md');
  }
  if (scope === 'project') {
    return path.join(roots.projectRoot, '.uagent', 'agent-memory', agentName, 'MEMORY.md');
  }
  return path.join(roots.projectRoot, '.uagent', 'agent-memory-local', agentName, 'MEMORY.md');
}

export function readAgentMemory(filePath: string, fsImpl: AgentMemoryFsLike = DEFAULT_FS): string {
  return fsImpl.existsSync(filePath) ? fsImpl.readFileSync(filePath, 'utf-8') : '';
}

export function writeAgentMemory(
  filePath: string,
  content: string,
  fsImpl: AgentMemoryFsLike = DEFAULT_FS,
): void {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  fsImpl.writeFileSync(filePath, content, 'utf-8');
}

const MEMORY_PATH_PATTERN = (agentName: string) => `agent-memory/${agentName}/*`;

/**
 * 声明了 `memory` 的 agent 自动获得 read/write/edit allow 规则，限定在
 * 其自己的 `agent-memory/<agentName>/*` 路径；未声明的 agent 不产出规则。
 * （本迭代先提供这个可独立测试的纯函数，真正接入 `agent/resolvers.ts`
 * 的 `resolvePermission` 是后续一处小改动，不在本次范围内改动其签名。）
 */
export function agentMemoryPermissionRules(agent: AgentInfo): Rule[] {
  if (!agent.memory) {
    return [];
  }
  const pattern = MEMORY_PATH_PATTERN(agent.name);
  return [
    { action: 'read', pattern, decision: 'allow' },
    { action: 'write', pattern, decision: 'allow' },
    { action: 'edit', pattern, decision: 'allow' },
  ];
}
