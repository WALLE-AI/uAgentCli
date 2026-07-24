import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toSessionID } from '../../../src/types/ids.js';
import type { RunContext } from '../../../src/types/abort.js';
import { readTool } from '../../../src/tool/builtin/read.js';

function makeCtx(): RunContext {
  return {
    signal: new AbortController().signal,
    sessionID: toSessionID('sess-1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('sess-1') },
  };
}

describe('read tool', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'uagentcli-read-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads full file content with line numbers', async () => {
    const file = path.join(dir, 'sample.txt');
    writeFileSync(file, 'a\nb\nc', 'utf-8');
    const result = await readTool.execute({ file_path: file }, makeCtx());
    expect(result.output).toBe('1\ta\n2\tb\n3\tc');
  });

  it('respects offset and limit', async () => {
    const file = path.join(dir, 'sample.txt');
    writeFileSync(file, 'a\nb\nc\nd\ne', 'utf-8');
    const result = await readTool.execute({ file_path: file, offset: 1, limit: 2 }, makeCtx());
    expect(result.output).toBe('2\tb\n3\tc');
  });

  it('throws for a missing file', async () => {
    await expect(readTool.execute({ file_path: path.join(dir, 'missing.txt') }, makeCtx())).rejects.toThrow();
  });

  it('is marked read-only and concurrency-safe', () => {
    expect(readTool.isReadOnly).toBe(true);
    expect(readTool.isConcurrencySafe).toBe(true);
  });
});
