import { describe, expect, it } from 'vitest';
import { createFakeFs } from '../helpers/fs.js';
import type { AgentInfo } from '../../src/agent/types.js';
import {
  agentMemoryPermissionRules,
  readAgentMemory,
  resolveAgentMemoryPath,
  writeAgentMemory,
} from '../../src/memory/agent-memory.js';

const ROOTS = { homeDir: '/home/user/.uagent', projectRoot: '/repo' };

function baseAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    name: 'explore',
    description: 'test',
    mode: 'asTool',
    source: 'builtin',
    prompt: 'test',
    ...overrides,
  };
}

describe('resolveAgentMemoryPath', () => {
  it('resolves user scope under homeDir', () => {
    expect(resolveAgentMemoryPath('explore', 'user', ROOTS)).toBe(
      '/home/user/.uagent/agent-memory/explore/MEMORY.md',
    );
  });

  it('resolves project scope under projectRoot/.uagent', () => {
    expect(resolveAgentMemoryPath('explore', 'project', ROOTS)).toBe(
      '/repo/.uagent/agent-memory/explore/MEMORY.md',
    );
  });

  it('resolves local scope to a distinct directory from project scope', () => {
    const local = resolveAgentMemoryPath('explore', 'local', ROOTS);
    const project = resolveAgentMemoryPath('explore', 'project', ROOTS);
    expect(local).not.toBe(project);
  });

  it('different agentNames produce physically distinct paths', () => {
    expect(resolveAgentMemoryPath('explore', 'user', ROOTS)).not.toBe(
      resolveAgentMemoryPath('general', 'user', ROOTS),
    );
  });
});

describe('read/writeAgentMemory + physical isolation', () => {
  it('writes and reads back the same content', () => {
    const { fsLike } = createFakeFs({});
    const path = resolveAgentMemoryPath('explore', 'user', ROOTS);
    writeAgentMemory(path, '# notes', fsLike);
    expect(readAgentMemory(path, fsLike)).toBe('# notes');
  });

  it('returns empty string when the file does not exist yet', () => {
    const { fsLike } = createFakeFs({});
    expect(readAgentMemory(resolveAgentMemoryPath('explore', 'user', ROOTS), fsLike)).toBe('');
  });

  it('two different agentNames cannot see each other\'s memory content', () => {
    const { fsLike } = createFakeFs({});
    const explorePath = resolveAgentMemoryPath('explore', 'user', ROOTS);
    const generalPath = resolveAgentMemoryPath('general', 'user', ROOTS);

    writeAgentMemory(explorePath, 'explore notes', fsLike);
    writeAgentMemory(generalPath, 'general notes', fsLike);

    expect(readAgentMemory(explorePath, fsLike)).toBe('explore notes');
    expect(readAgentMemory(generalPath, fsLike)).toBe('general notes');
  });
});

describe('agentMemoryPermissionRules', () => {
  it('agents declaring memory get read/write/edit allow rules scoped to their own directory', () => {
    const agent = baseAgent({ memory: 'project' });
    const rules = agentMemoryPermissionRules(agent);
    expect(rules).toEqual([
      { action: 'read', pattern: 'agent-memory/explore/*', decision: 'allow' },
      { action: 'write', pattern: 'agent-memory/explore/*', decision: 'allow' },
      { action: 'edit', pattern: 'agent-memory/explore/*', decision: 'allow' },
    ]);
  });

  it('agents without a declared memory scope get no rules', () => {
    const agent = baseAgent();
    expect(agentMemoryPermissionRules(agent)).toEqual([]);
  });

  it('different agent names get non-overlapping patterns', () => {
    const explore = agentMemoryPermissionRules(baseAgent({ name: 'explore', memory: 'user' }));
    const general = agentMemoryPermissionRules(baseAgent({ name: 'general', memory: 'user' }));
    expect(explore[0].pattern).not.toBe(general[0].pattern);
  });
});
