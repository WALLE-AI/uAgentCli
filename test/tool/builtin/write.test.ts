import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toSessionID } from '../../../src/types/ids.js';
import type { RunContext } from '../../../src/types/abort.js';
import { writeTool } from '../../../src/tool/builtin/write.js';

function makeCtx(): RunContext {
  return {
    signal: new AbortController().signal,
    sessionID: toSessionID('sess-1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('sess-1') },
  };
}

describe('write tool', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'uagentcli-write-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a new file with the given content', async () => {
    const file = path.join(dir, 'out.txt');
    await writeTool.execute({ file_path: file, content: 'hello' }, makeCtx());
    expect(readFileSync(file, 'utf-8')).toBe('hello');
  });

  it('creates missing parent directories', async () => {
    const file = path.join(dir, 'nested', 'deep', 'out.txt');
    await writeTool.execute({ file_path: file, content: 'nested' }, makeCtx());
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('nested');
  });

  it('overwrites an existing file', async () => {
    const file = path.join(dir, 'out.txt');
    await writeTool.execute({ file_path: file, content: 'first' }, makeCtx());
    await writeTool.execute({ file_path: file, content: 'second' }, makeCtx());
    expect(readFileSync(file, 'utf-8')).toBe('second');
  });

  it('is marked as a destructive, non-concurrency-safe write', () => {
    expect(writeTool.isReadOnly).toBe(false);
    expect(writeTool.isConcurrencySafe).toBe(false);
    expect(writeTool.isDestructive).toBe(true);
  });
});
