import { describe, expect, it } from 'vitest';
import type { SkillInfo } from '../../src/skill/types.js';
import { formatSkills } from '../../src/skill/registry.js';

const SKILLS: SkillInfo[] = [
  { name: 'db-migration', description: 'Review migrations', location: '/a/SKILL.md', content: 'FULL BODY TEXT' },
];

describe('formatSkills', () => {
  it('verbose:true produces XML with name/description/location', () => {
    const output = formatSkills(SKILLS, { verbose: true });
    expect(output).toContain('<available_skills>');
    expect(output).toContain('<name>db-migration</name>');
    expect(output).toContain('<description>Review migrations</description>');
    expect(output).toContain('<location>/a/SKILL.md</location>');
  });

  it('verbose:false produces a terse markdown list', () => {
    const output = formatSkills(SKILLS, { verbose: false });
    expect(output).toContain('## Available Skills');
    expect(output).toContain('- **db-migration**: Review migrations');
  });

  it('neither format exposes the skill body (progressive disclosure)', () => {
    expect(formatSkills(SKILLS, { verbose: true })).not.toContain('FULL BODY TEXT');
    expect(formatSkills(SKILLS, { verbose: false })).not.toContain('FULL BODY TEXT');
  });

  it('handles an empty skill list gracefully in both formats', () => {
    expect(formatSkills([], { verbose: true })).toContain('no skills discovered');
    expect(formatSkills([], { verbose: false })).toContain('no skills discovered');
  });

  it('escapes XML-unsafe characters in verbose mode', () => {
    const skills: SkillInfo[] = [
      { name: 'a<b>', description: 'x & y', location: '/l', content: '' },
    ];
    const output = formatSkills(skills, { verbose: true });
    expect(output).not.toContain('<b>');
    expect(output).toContain('&lt;b&gt;');
    expect(output).toContain('&amp;');
  });
});
