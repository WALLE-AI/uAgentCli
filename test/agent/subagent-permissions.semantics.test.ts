import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../src/agent/types.js';
import type { Ruleset } from '../../src/permission/types.js';
import { deriveSubagentSessionPermission } from '../../src/agent/subagent-permissions.js';
import { evaluate } from '../../src/permission/evaluate.js';

/**
 * T1.11 顺延的语义单测：deriveSubagentSessionPermission 产出的 Ruleset
 * 经真实 evaluate()（last-match-wins）判定后，确实是"deny-only"——
 * 子会话拿不到任何父会话的 allow 权限，task/todowrite 始终被拒。
 */
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

describe('deriveSubagentSessionPermission (semantics via evaluate())', () => {
  const parent: Ruleset = {
    rules: [
      { action: 'read', pattern: '*', decision: 'allow' },
      { action: 'write', pattern: '*', decision: 'allow' },
      { action: 'execute', pattern: '*', decision: 'allow' },
      { action: 'read', pattern: '/etc/*', decision: 'deny' },
      { action: 'external_directory', pattern: '/tmp/*', decision: 'ask' },
    ],
  };

  it('task/todowrite evaluate to deny even when an outer ruleset allowed them first (last-match-wins still lands on the forced deny)', () => {
    const derived = deriveSubagentSessionPermission(parent, makeSubagent());
    const outerAllowsEverything: Ruleset = {
      rules: [
        { action: 'task', pattern: '*', decision: 'allow' },
        { action: 'todowrite', pattern: '*', decision: 'allow' },
      ],
    };

    expect(evaluate('task', 'delegate', outerAllowsEverything, derived).decision).toBe('deny');
    expect(evaluate('todowrite', 'add', outerAllowsEverything, derived).decision).toBe('deny');
  });

  it('inherited parent deny rules still block the specific pattern they targeted', () => {
    const derived = deriveSubagentSessionPermission(parent, makeSubagent());
    expect(evaluate('read', '/etc/passwd', derived).decision).toBe('deny');
  });

  it('none of the parent allow rules survive: unmatched actions fall back to ask, not allow', () => {
    const derived = deriveSubagentSessionPermission(parent, makeSubagent());
    // parent allowed read/write/execute broadly; derived has none of that,
    // so a path/action not covered by an explicit deny defaults to ask.
    expect(evaluate('read', '/home/user/project/file.ts', derived).decision).toBe('ask');
    expect(evaluate('write', '/home/user/project/file.ts', derived).decision).toBe('ask');
    expect(evaluate('execute', 'ls', derived).decision).toBe('ask');
  });

  it('external_directory rules are inherited verbatim (decision preserved, not forced to deny)', () => {
    const derived = deriveSubagentSessionPermission(parent, makeSubagent());
    expect(evaluate('external_directory', '/tmp/scratch', derived).decision).toBe('ask');
  });

  it('a subagent that explicitly declares task:allow is not forced to deny by the derivation step', () => {
    const subagent = makeSubagent({
      permission: { rules: [{ action: 'task', pattern: '*', decision: 'allow' }] },
    });
    const derived = deriveSubagentSessionPermission(parent, subagent);
    // Derivation itself doesn't inject a deny; the subagent's own declared
    // rule is not part of `derived` (that merge happens in resolvePermission),
    // so evaluating derived alone for task should NOT find a deny rule.
    expect(evaluate('task', 'delegate', derived).decision).toBe('ask');
  });
});
