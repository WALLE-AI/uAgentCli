import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { resolveScope, sanitizeProjectId } from '../../src/storage/paths.js';

describe('sanitizeProjectId', () => {
  it('is idempotent: repeated calls with the same cwd produce the same id', () => {
    const a = sanitizeProjectId('/home/user/my-project');
    const b = sanitizeProjectId('/home/user/my-project');
    expect(a).toBe(b);
  });

  it('produces different ids for different paths, even with the same basename', () => {
    const a = sanitizeProjectId('/home/user/foo/app');
    const b = sanitizeProjectId('/home/user/bar/app');
    expect(a).not.toBe(b);
  });

  it('sanitizes characters unsafe for filesystem paths', () => {
    const id = sanitizeProjectId('/home/user/My Project (v2)!');
    expect(id).toMatch(/^[a-z0-9._-]+$/);
  });

  it('never returns an empty slug component even for root-like paths', () => {
    const id = sanitizeProjectId('/');
    expect(id.length).toBeGreaterThan(0);
  });
});

describe('resolveScope', () => {
  it('prefers UAGENT_HOME when set', () => {
    const scope = resolveScope('/home/user/project', { UAGENT_HOME: '/custom/uagent' });
    expect(scope.home).toBe('/custom/uagent');
    expect(scope.project.startsWith('/custom/uagent')).toBe(true);
  });

  it('falls back to ~/.uagent when UAGENT_HOME is unset or empty', () => {
    const unset = resolveScope('/home/user/project', {});
    expect(unset.home).toBe(path.join(os.homedir(), '.uagent'));

    const empty = resolveScope('/home/user/project', { UAGENT_HOME: '' });
    expect(empty.home).toBe(path.join(os.homedir(), '.uagent'));
  });

  it('project path is a deterministic function of cwd', () => {
    const a = resolveScope('/home/user/project', { UAGENT_HOME: '/h' });
    const b = resolveScope('/home/user/project', { UAGENT_HOME: '/h' });
    expect(a.project).toBe(b.project);
  });
});
