import { describe, expect, it } from 'vitest';
import { createFakeFs } from '../helpers/fs.js';
import { AgentRegistry, createBuiltinAgents } from '../../src/agent/registry.js';

describe('createBuiltinAgents', () => {
  it('registers build/plan/general/explore/compactor/memory-extractor', () => {
    const names = createBuiltinAgents().map((a) => a.name).sort();
    expect(names).toEqual([
      'build',
      'compactor',
      'explore',
      'general',
      'memory-extractor',
      'plan',
    ].sort());
  });

  it('compactor and memory-extractor have zero tools (stricter than deny)', () => {
    const agents = createBuiltinAgents();
    expect(agents.find((a) => a.name === 'compactor')?.tools).toEqual([]);
    expect(agents.find((a) => a.name === 'memory-extractor')?.tools).toEqual([]);
  });

  it('every non-build/plan agent excludes the task tool at registration', () => {
    const agents = createBuiltinAgents();
    for (const agent of agents) {
      if (agent.name === 'build' || agent.name === 'plan') continue;
      expect(agent.tools ?? []).not.toContain('task');
    }
  });

  it('explore only carries read-only tools', () => {
    const explore = createBuiltinAgents().find((a) => a.name === 'explore');
    expect(explore?.tools).toEqual(['read', 'grep', 'glob', 'webfetch']);
  });

  it('plan restricts write/edit to .uagent/plans/*.md via explicit permission', () => {
    const plan = createBuiltinAgents().find((a) => a.name === 'plan');
    expect(plan?.permission?.rules).toContainEqual({
      action: 'write',
      pattern: '.uagent/plans/*.md',
      decision: 'allow',
    });
    expect(plan?.permission?.rules).toContainEqual({
      action: 'write',
      pattern: '*',
      decision: 'deny',
    });
  });
});

describe('AgentRegistry merge order', () => {
  it('builtin < user < project: project-defined agent with the same name as a builtin wins', () => {
    const { fsLike: fs } = createFakeFs({
      '/repo/.uagent/agents/explore.md': `---
name: explore
description: project override of the built-in explore agent
---
Custom explore behavior.
`,
    });
    const registry = new AgentRegistry({ userDir: '/home/user', projectDir: '/repo', fs });
    const explore = registry.get('explore');
    expect(explore?.source).toBe('project');
    expect(explore?.description).toContain('project override');
  });

  it('flag agents override everything else', () => {
    const { fsLike: fs } = createFakeFs({});
    const registry = new AgentRegistry({
      userDir: '/home/user',
      projectDir: '/repo',
      fs,
      flagAgents: [
        {
          name: 'build',
          description: 'one-shot flag override',
          mode: 'asTool',
          source: 'project',
          prompt: 'flag prompt',
        },
      ],
    });
    const build = registry.get('build');
    expect(build?.source).toBe('flag');
    expect(build?.description).toBe('one-shot flag override');
  });

  it('unregistered names return undefined', () => {
    const { fsLike: fs } = createFakeFs({});
    const registry = new AgentRegistry({ userDir: '/home/user', projectDir: '/repo', fs });
    expect(registry.get('does-not-exist')).toBeUndefined();
  });
});
