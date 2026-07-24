import { describe, expect, it } from 'vitest';
import { createFakeFs } from '../helpers/fs.js';
import {
  loadApprovedRules,
  persistApprovedRule,
  persistOnReply,
  resolvePersistPaths,
  type PersistPaths,
} from '../../src/permission/persist.js';
import type { Rule } from '../../src/permission/types.js';

const RULE: Rule = { action: 'write', pattern: 'foo.txt', decision: 'allow' };

function makePaths(): PersistPaths {
  return resolvePersistPaths('/home/user/.uagent', '/home/user/project');
}

describe('resolvePersistPaths', () => {
  it('produces distinct local/user/project file paths', () => {
    const paths = makePaths();
    expect(paths.local).toBe('/home/user/project/.uagent/settings.local.json');
    expect(paths.user).toBe('/home/user/.uagent/settings.json');
    expect(paths.project).toBe('/home/user/project/.uagent/settings.json');
  });
});

describe('persistApprovedRule / loadApprovedRules', () => {
  it('writes to the local tier file and reads it back', () => {
    const { fsLike } = createFakeFs({});
    const paths = makePaths();
    persistApprovedRule('local', RULE, paths, fsLike);
    expect(loadApprovedRules('local', paths, fsLike)).toEqual([RULE]);
    // the other two tiers remain untouched
    expect(fsLike.existsSync(paths.user)).toBe(false);
    expect(fsLike.existsSync(paths.project)).toBe(false);
  });

  it('writes to the user tier file independently of local/project', () => {
    const { fsLike } = createFakeFs({});
    const paths = makePaths();
    persistApprovedRule('user', RULE, paths, fsLike);
    expect(loadApprovedRules('user', paths, fsLike)).toEqual([RULE]);
    expect(fsLike.existsSync(paths.local)).toBe(false);
  });

  it('writes to the project tier file independently of local/user', () => {
    const { fsLike } = createFakeFs({});
    const paths = makePaths();
    persistApprovedRule('project', RULE, paths, fsLike);
    expect(loadApprovedRules('project', paths, fsLike)).toEqual([RULE]);
    expect(fsLike.existsSync(paths.user)).toBe(false);
  });

  it('appends to an existing file rather than overwriting prior rules', () => {
    const { fsLike } = createFakeFs({});
    const paths = makePaths();
    const other: Rule = { action: 'read', pattern: '*', decision: 'allow' };
    persistApprovedRule('local', RULE, paths, fsLike);
    persistApprovedRule('local', other, paths, fsLike);
    expect(loadApprovedRules('local', paths, fsLike)).toEqual([RULE, other]);
  });

  it('all three tiers can independently hold approvals ("三处文件")', () => {
    const { fsLike } = createFakeFs({});
    const paths = makePaths();
    persistApprovedRule('local', { action: 'write', pattern: 'a', decision: 'allow' }, paths, fsLike);
    persistApprovedRule('user', { action: 'read', pattern: 'b', decision: 'allow' }, paths, fsLike);
    persistApprovedRule('project', { action: 'execute', pattern: 'c', decision: 'allow' }, paths, fsLike);

    expect(fsLike.existsSync(paths.local)).toBe(true);
    expect(fsLike.existsSync(paths.user)).toBe(true);
    expect(fsLike.existsSync(paths.project)).toBe(true);
    expect(loadApprovedRules('local', paths, fsLike)[0].pattern).toBe('a');
    expect(loadApprovedRules('user', paths, fsLike)[0].pattern).toBe('b');
    expect(loadApprovedRules('project', paths, fsLike)[0].pattern).toBe('c');
  });
});

describe('persistOnReply', () => {
  it('once: never writes to disk', () => {
    const { fsLike } = createFakeFs({});
    const paths = makePaths();
    persistOnReply({ reply: 'once' }, RULE, paths, fsLike);
    expect(fsLike.existsSync(paths.local)).toBe(false);
    expect(fsLike.existsSync(paths.user)).toBe(false);
    expect(fsLike.existsSync(paths.project)).toBe(false);
  });

  it('reject: never writes to disk', () => {
    const { fsLike } = createFakeFs({});
    const paths = makePaths();
    persistOnReply({ reply: 'reject' }, RULE, paths, fsLike);
    expect(fsLike.existsSync(paths.local)).toBe(false);
  });

  it('always: writes to the requested scope (default local)', () => {
    const { fsLike } = createFakeFs({});
    const paths = makePaths();
    persistOnReply({ reply: 'always' }, RULE, paths, fsLike);
    expect(loadApprovedRules('local', paths, fsLike)).toEqual([RULE]);
  });

  it('always with an explicit scope writes to that scope', () => {
    const { fsLike } = createFakeFs({});
    const paths = makePaths();
    persistOnReply({ reply: 'always', scope: 'project' }, RULE, paths, fsLike);
    expect(loadApprovedRules('project', paths, fsLike)).toEqual([RULE]);
    expect(fsLike.existsSync(paths.local)).toBe(false);
  });
});
