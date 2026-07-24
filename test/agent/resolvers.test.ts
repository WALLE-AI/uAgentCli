import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../src/agent/types.js';
import type { Ruleset } from '../../src/permission/types.js';
import { resolveModel, resolvePermission, resolvePrompt, resolveTools } from '../../src/agent/resolvers.js';

function baseAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    name: 'test-agent',
    description: 'test',
    mode: 'asTool',
    source: 'builtin',
    prompt: 'You are a test agent.',
    ...overrides,
  };
}

describe('resolveTools', () => {
  it('translates tools:[read,grep] into read/grep allow + the rest denied', () => {
    const ruleset = resolveTools(baseAgent({ tools: ['read', 'grep'] }));
    const allow = ruleset.rules.filter((r) => r.decision === 'allow');
    const deny = ruleset.rules.filter((r) => r.decision === 'deny');

    expect(allow).toEqual([
      { action: 'read', pattern: 'read', decision: 'allow' },
      { action: 'read', pattern: 'grep', decision: 'allow' },
    ]);
    expect(deny.map((r) => r.action).sort()).toEqual(['edit', 'execute', 'write']);
  });

  it('returns an empty ruleset when tools is not declared', () => {
    expect(resolveTools(baseAgent())).toEqual({ rules: [] });
  });
});

describe('resolveModel', () => {
  it('falls back to defaultModel when unset or "inherit"', () => {
    expect(resolveModel(baseAgent(), 'claude-sonnet-5')).toBe('claude-sonnet-5');
    expect(resolveModel(baseAgent({ model: 'inherit' }), 'claude-sonnet-5')).toBe('claude-sonnet-5');
  });

  it('uses the declared concrete model id otherwise', () => {
    expect(resolveModel(baseAgent({ model: 'claude-haiku-4-5' }), 'claude-sonnet-5')).toBe(
      'claude-haiku-4-5',
    );
  });
});

describe('resolvePrompt', () => {
  it('returns the agent markdown body verbatim', () => {
    expect(resolvePrompt(baseAgent({ prompt: 'custom body' }))).toBe('custom body');
  });
});

describe('resolvePermission', () => {
  it('combines tools sugar, explicit permission, and inherited deny-only rules', () => {
    const parent: Ruleset = {
      rules: [
        { action: 'write', pattern: '*', decision: 'allow' },
        { action: 'read', pattern: '/etc/*', decision: 'deny' },
        { action: 'external_directory', pattern: '/tmp', decision: 'ask' },
      ],
    };
    const agent = baseAgent({ tools: ['read'] });
    const result = resolvePermission(agent, parent);

    // tools sugar present
    expect(result.rules).toContainEqual({ action: 'read', pattern: 'read', decision: 'allow' });
    // inherited: parent allow rules stripped, deny + external_directory kept
    expect(result.rules).toContainEqual({ action: 'read', pattern: '/etc/*', decision: 'deny' });
    expect(result.rules).toContainEqual({ action: 'external_directory', pattern: '/tmp', decision: 'ask' });
    expect(result.rules).not.toContainEqual({ action: 'write', pattern: '*', decision: 'allow' });
    // forced deny for task/todowrite since agent didn't declare allow
    expect(result.rules).toContainEqual({ action: 'task', pattern: '*', decision: 'deny' });
    expect(result.rules).toContainEqual({ action: 'todowrite', pattern: '*', decision: 'deny' });
  });
});

describe('four resolvers are independently callable (no shared state)', () => {
  it('calling resolvers in any order or repeatedly yields the same results', () => {
    const agent = baseAgent({ tools: ['read', 'grep'], model: 'claude-haiku-4-5' });
    const parent: Ruleset = { rules: [] };

    const first = {
      tools: resolveTools(agent),
      model: resolveModel(agent, 'default-model'),
      prompt: resolvePrompt(agent),
      permission: resolvePermission(agent, parent),
    };
    const second = {
      permission: resolvePermission(agent, parent),
      prompt: resolvePrompt(agent),
      model: resolveModel(agent, 'default-model'),
      tools: resolveTools(agent),
    };

    expect(first).toEqual(second);
  });
});
