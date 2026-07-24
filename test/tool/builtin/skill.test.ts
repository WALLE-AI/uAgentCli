import { describe, expect, it } from 'vitest';
import { createSkillTool } from '../../../src/tool/builtin/skill.js';
import type { SkillInfo } from '../../../src/skill/types.js';
import type { RunContext } from '../../../src/types/abort.js';
import { toSessionID } from '../../../src/types/ids.js';

function ctx(): RunContext {
  const sessionID = toSessionID('s1');
  return { signal: new AbortController().signal, sessionID, depth: 0, permission: { mode: 'default', sessionID } };
}

const SKILLS: SkillInfo[] = [
  { name: 'commit-style', description: 'commit message conventions', location: '/repo/.agents/skills/commit-style/SKILL.md', content: '# Commit Style\nUse conventional commits.' },
];

describe('createSkillTool', () => {
  it('returns the full SKILL.md body when the name matches a discovered skill', async () => {
    const tool = createSkillTool(SKILLS);
    const result = await tool.execute({ name: 'commit-style' }, ctx());
    expect(result.output).toBe('# Commit Style\nUse conventional commits.');
  });

  it('does not throw on an unknown skill name -- returns a clear message listing available skills', async () => {
    const tool = createSkillTool(SKILLS);
    const result = await tool.execute({ name: 'nope' }, ctx());
    expect(result.output).toContain('Unknown skill "nope"');
    expect(result.output).toContain('commit-style');
  });

  it('handles an empty discovered-skills list without throwing', async () => {
    const tool = createSkillTool([]);
    const result = await tool.execute({ name: 'anything' }, ctx());
    expect(result.output).toContain('(none discovered)');
  });

  it('is marked read-only / concurrency-safe / non-destructive', () => {
    const tool = createSkillTool(SKILLS);
    expect(tool.isReadOnly).toBe(true);
    expect(tool.isConcurrencySafe).toBe(true);
    expect(tool.isDestructive).toBe(false);
  });
});
