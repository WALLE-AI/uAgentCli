import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toSessionID } from '../../../src/types/ids.js';
import type { RunContext } from '../../../src/types/abort.js';
import { grepTool } from '../../../src/tool/builtin/grep.js';

function makeCtx(): RunContext {
  return {
    signal: new AbortController().signal,
    sessionID: toSessionID('sess-1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('sess-1') },
  };
}

describe('grep tool', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'uagentcli-grep-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds matches across files with file:line:content format', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'hello world\nfoo bar', 'utf-8');
    writeFileSync(path.join(dir, 'b.txt'), 'no match here', 'utf-8');
    const result = await grepTool.execute({ pattern: 'foo', path: dir }, makeCtx());
    expect(result.output).toBe('a.txt:2:foo bar');
  });

  it('is case-insensitive when caseInsensitive is set', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'HELLO', 'utf-8');
    const result = await grepTool.execute({ pattern: 'hello', path: dir, caseInsensitive: true }, makeCtx());
    expect(result.output).toBe('a.txt:1:HELLO');
  });

  it('filters files by glob', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'match', 'utf-8');
    writeFileSync(path.join(dir, 'a.md'), 'match', 'utf-8');
    const result = await grepTool.execute({ pattern: 'match', path: dir, glob: '*.md' }, makeCtx());
    expect(result.output).toBe('a.md:1:match');
  });

  it('skips node_modules and .git directories', async () => {
    mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules', 'x.txt'), 'match', 'utf-8');
    const result = await grepTool.execute({ pattern: 'match', path: dir }, makeCtx());
    expect(result.output).toBe('(no matches)');
  });

  it('returns "(no matches)" when nothing matches', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'nothing', 'utf-8');
    const result = await grepTool.execute({ pattern: 'zzz', path: dir }, makeCtx());
    expect(result.output).toBe('(no matches)');
  });

  it('is marked read-only and concurrency-safe', () => {
    expect(grepTool.isReadOnly).toBe(true);
    expect(grepTool.isConcurrencySafe).toBe(true);
  });
});
