import { describe, expect, it } from 'vitest';
import { createFakeFs } from '../helpers/fs.js';
import { defaultScanDirs, loadAgentsFromMarkdown } from '../../src/agent/loader.js';

const VALID_AGENT = `---
name: db-reviewer
description: Reviews database migrations for safety.
mode: asTool
tools:
  - read
  - grep
---
You are a database migration reviewer. Check migrations for locking issues
and unsafe schema changes before they run against production.
`;

describe('agent loader', () => {
  it('parses a well-formed frontmatter + body file into an AgentInfo', () => {
    const { fsLike: fs } = createFakeFs({
      '/home/user/.uagent/agents/db-reviewer.md': VALID_AGENT,
    });
    const { agents, issues } = loadAgentsFromMarkdown(
      [{ source: 'user', dir: '/home/user/.uagent/agents' }],
      fs,
    );

    expect(issues).toEqual([]);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: 'db-reviewer',
      description: 'Reviews database migrations for safety.',
      mode: 'asTool',
      source: 'user',
      tools: ['read', 'grep'],
    });
    expect(agents[0].prompt).toContain('database migration reviewer');
  });

  it('project-scope agents override same-named user-scope agents', () => {
    const { fsLike: fs } = createFakeFs({
      '/home/user/.uagent/agents/db-reviewer.md': VALID_AGENT,
      '/repo/.uagent/agents/db-reviewer.md': VALID_AGENT.replace(
        'Reviews database migrations for safety.',
        'Project override description.',
      ),
    });
    const { agents } = loadAgentsFromMarkdown(
      defaultScanDirs('/home/user', '/repo'),
      fs,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0].source).toBe('project');
    expect(agents[0].description).toBe('Project override description.');
  });

  it('records an issue for a file missing frontmatter, without adding an agent', () => {
    const { fsLike: fs } = createFakeFs({
      '/home/user/.uagent/agents/broken.md': 'just a plain markdown file, no frontmatter',
    });
    const { agents, issues } = loadAgentsFromMarkdown(
      [{ source: 'user', dir: '/home/user/.uagent/agents' }],
      fs,
    );

    expect(agents).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/frontmatter/);
  });

  it('records an issue for a field with the wrong type', () => {
    const { fsLike: fs } = createFakeFs({
      '/home/user/.uagent/agents/bad-tools.md': `---
name: bad-tools
description: has a malformed tools field
tools: "not-an-array"
---
Body text here.
`,
    });
    const { agents, issues } = loadAgentsFromMarkdown(
      [{ source: 'user', dir: '/home/user/.uagent/agents' }],
      fs,
    );

    expect(agents).toEqual([]);
    expect(issues[0].message).toMatch(/tools/);
  });

  it('records an issue for an empty prompt body', () => {
    const { fsLike: fs } = createFakeFs({
      '/home/user/.uagent/agents/empty-body.md': `---
name: empty-body
description: has no body
---
`,
    });
    const { agents, issues } = loadAgentsFromMarkdown(
      [{ source: 'user', dir: '/home/user/.uagent/agents' }],
      fs,
    );

    expect(agents).toEqual([]);
    expect(issues[0].message).toMatch(/empty/);
  });

  it('skips scan directories that do not exist', () => {
    const { fsLike: fs } = createFakeFs({});
    const { agents, issues } = loadAgentsFromMarkdown(
      [{ source: 'user', dir: '/nonexistent' }],
      fs,
    );
    expect(agents).toEqual([]);
    expect(issues).toEqual([]);
  });
});
