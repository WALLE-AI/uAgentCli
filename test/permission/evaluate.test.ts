import { describe, expect, it } from 'vitest';
import type { Ruleset } from '../../src/permission/types.js';
import { evaluate } from '../../src/permission/evaluate.js';

describe('evaluate (last-match-wins)', () => {
  it('returns the last matching rule when several rules match the same pattern', () => {
    const ruleset: Ruleset = {
      rules: [
        { action: 'read', pattern: '*', decision: 'allow' },
        { action: 'read', pattern: '*', decision: 'deny' },
      ],
    };
    expect(evaluate('read', 'anything.txt', ruleset).decision).toBe('deny');
  });

  it('defaults to ask when nothing matches', () => {
    const ruleset: Ruleset = { rules: [{ action: 'write', pattern: '*', decision: 'allow' }] };
    const result = evaluate('read', 'file.txt', ruleset);
    expect(result.decision).toBe('ask');
  });

  it('matches glob patterns, not just exact strings', () => {
    const ruleset: Ruleset = {
      rules: [{ action: 'write', pattern: '.uagent/plans/*.md', decision: 'allow' }],
    };
    expect(evaluate('write', '.uagent/plans/foo.md', ruleset).decision).toBe('allow');
    expect(evaluate('write', 'src/index.ts', ruleset).decision).toBe('ask');
  });

  it('merges multiple rulesets in call order, later rulesets take precedence', () => {
    const parent: Ruleset = { rules: [{ action: 'read', pattern: '*', decision: 'deny' }] };
    const child: Ruleset = { rules: [{ action: 'read', pattern: '*', decision: 'allow' }] };
    expect(evaluate('read', 'x', parent, child).decision).toBe('allow');
    expect(evaluate('read', 'x', child, parent).decision).toBe('deny');
  });

  it('only considers rules whose action matches, even if the pattern would match', () => {
    const ruleset: Ruleset = { rules: [{ action: 'write', pattern: '*', decision: 'deny' }] };
    expect(evaluate('read', 'file.txt', ruleset).decision).toBe('ask');
  });
});
