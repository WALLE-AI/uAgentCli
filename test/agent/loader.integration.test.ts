import { describe, expect, it } from 'vitest';
import { loadAgentsFromMarkdown } from '../../src/agent/loader.js';

describe('agent loader (real filesystem, zero-code extension)', () => {
  it('parses the example .uagent/agents/db-reviewer.md shipped in the repo', () => {
    const { agents, issues } = loadAgentsFromMarkdown([
      { source: 'project', dir: `${process.cwd()}/.uagent/agents` },
    ]);

    expect(issues).toEqual([]);
    const dbReviewer = agents.find((a) => a.name === 'db-reviewer');
    expect(dbReviewer).toBeDefined();
    expect(dbReviewer?.tools).toEqual(['read', 'grep']);
    expect(dbReviewer?.prompt).toContain('database migration reviewer');
  });
});
