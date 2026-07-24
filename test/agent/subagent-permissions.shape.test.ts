import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../src/agent/types.js';
import type { Ruleset } from '../../src/permission/types.js';
import { deriveSubagentSessionPermission } from '../../src/agent/subagent-permissions.js';

function makeSubagent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    name: 'explore',
    description: 'test',
    mode: 'asTool',
    source: 'builtin',
    prompt: 'test',
    ...overrides,
  };
}

describe('deriveSubagentSessionPermission (shape)', () => {
  const parent: Ruleset = {
    rules: [
      { action: 'write', pattern: '*', decision: 'allow' },
      { action: 'read', pattern: '*', decision: 'allow' },
      { action: 'read', pattern: '/etc/*', decision: 'deny' },
      { action: 'external_directory', pattern: '/tmp', decision: 'ask' },
      { action: 'execute', pattern: 'rm -rf *', decision: 'deny' },
    ],
  };

  it('keeps parent deny rules', () => {
    const result = deriveSubagentSessionPermission(parent, makeSubagent());
    expect(result.rules).toContainEqual({ action: 'read', pattern: '/etc/*', decision: 'deny' });
    expect(result.rules).toContainEqual({ action: 'execute', pattern: 'rm -rf *', decision: 'deny' });
  });

  it('keeps parent external_directory rules regardless of decision', () => {
    const result = deriveSubagentSessionPermission(parent, makeSubagent());
    expect(result.rules).toContainEqual({
      action: 'external_directory',
      pattern: '/tmp',
      decision: 'ask',
    });
  });

  it('strips every parent allow rule', () => {
    const result = deriveSubagentSessionPermission(parent, makeSubagent());
    expect(result.rules).not.toContainEqual({ action: 'write', pattern: '*', decision: 'allow' });
    expect(result.rules).not.toContainEqual({ action: 'read', pattern: '*', decision: 'allow' });
  });

  it('force-denies todowrite and task when the subagent does not explicitly allow them', () => {
    const result = deriveSubagentSessionPermission(parent, makeSubagent());
    expect(result.rules).toContainEqual({ action: 'todowrite', pattern: '*', decision: 'deny' });
    expect(result.rules).toContainEqual({ action: 'task', pattern: '*', decision: 'deny' });
  });

  it('does not force-deny task/todowrite when the subagent explicitly declares allow', () => {
    const subagent = makeSubagent({
      permission: {
        rules: [
          { action: 'task', pattern: '*', decision: 'allow' },
          { action: 'todowrite', pattern: '*', decision: 'allow' },
        ],
      },
    });
    const result = deriveSubagentSessionPermission(parent, subagent);
    expect(result.rules).not.toContainEqual({ action: 'task', pattern: '*', decision: 'deny' });
    expect(result.rules).not.toContainEqual({ action: 'todowrite', pattern: '*', decision: 'deny' });
  });

  it('produces an empty base (only forced denies) when the parent has no deny/external_directory rules', () => {
    const emptyParent: Ruleset = { rules: [{ action: 'write', pattern: '*', decision: 'allow' }] };
    const result = deriveSubagentSessionPermission(emptyParent, makeSubagent());
    expect(result.rules).toEqual([
      { action: 'todowrite', pattern: '*', decision: 'deny' },
      { action: 'task', pattern: '*', decision: 'deny' },
    ]);
  });
});
