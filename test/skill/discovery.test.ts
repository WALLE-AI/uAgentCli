import { describe, expect, it } from 'vitest';
import { createFakeFs } from '../helpers/fs.js';
import { discoverSkills } from '../../src/skill/discovery.js';

const SKILL_MD = `---
name: db-migration
description: Reviews database migrations for safety
---
Full instructions go here.
`;

describe('discoverSkills', () => {
  it('finds a SKILL.md nested under .agents/skills', () => {
    const { fsLike } = createFakeFs({
      '/repo/.agents/skills/db-migration/SKILL.md': SKILL_MD,
    });
    const skills = discoverSkills(['/repo/.agents/skills'], fsLike);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: 'db-migration',
      description: 'Reviews database migrations for safety',
      location: '/repo/.agents/skills/db-migration/SKILL.md',
    });
    expect(skills[0].content).toContain('Full instructions go here.');
  });

  it('recurses through nested directories', () => {
    const { fsLike } = createFakeFs({
      '/repo/.agents/skills/a/b/c/SKILL.md': SKILL_MD,
    });
    const skills = discoverSkills(['/repo/.agents/skills'], fsLike);
    expect(skills).toHaveLength(1);
  });

  it('finds multiple skills across multiple root directories', () => {
    const { fsLike } = createFakeFs({
      '/repo/.agents/skills/one/SKILL.md': SKILL_MD,
      '/home/user/.agents/skills/two/SKILL.md': SKILL_MD.replace('db-migration', 'other-skill'),
    });
    const skills = discoverSkills(['/repo/.agents/skills', '/home/user/.agents/skills'], fsLike);
    expect(skills.map((s) => s.name).sort()).toEqual(['db-migration', 'other-skill']);
  });

  it('ignores non-SKILL.md files', () => {
    const { fsLike } = createFakeFs({
      '/repo/.agents/skills/README.md': '# not a skill',
      '/repo/.agents/skills/notes.txt': 'irrelevant',
    });
    expect(discoverSkills(['/repo/.agents/skills'], fsLike)).toEqual([]);
  });

  it('skips a SKILL.md with missing frontmatter fields rather than throwing', () => {
    const { fsLike } = createFakeFs({
      '/repo/.agents/skills/broken/SKILL.md': '---\nname: only-name\n---\nbody',
    });
    expect(discoverSkills(['/repo/.agents/skills'], fsLike)).toEqual([]);
  });

  it('returns an empty list when the root directory does not exist', () => {
    const { fsLike } = createFakeFs({});
    expect(discoverSkills(['/nonexistent'], fsLike)).toEqual([]);
  });
});
