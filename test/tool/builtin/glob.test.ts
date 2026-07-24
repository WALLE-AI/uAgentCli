import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toSessionID } from '../../../src/types/ids.js';
import type { RunContext } from '../../../src/types/abort.js';
import { globTool } from '../../../src/tool/builtin/glob.js';

function makeCtx(): RunContext {
  return {
    signal: new AbortController().signal,
    sessionID: toSessionID('sess-1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('sess-1') },
  };
}

describe('glob tool', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'uagentcli-glob-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('matches files by extension with *', async () => {
    writeFileSync(path.join(dir, 'a.ts'), '', 'utf-8');
    writeFileSync(path.join(dir, 'b.md'), '', 'utf-8');
    const result = await globTool.execute({ pattern: '*.ts', path: dir }, makeCtx());
    expect(result.output).toBe('a.ts');
  });

  it('matches nested files with **', async () => {
    mkdirSync(path.join(dir, 'src', 'nested'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'nested', 'x.ts'), '', 'utf-8');
    const result = await globTool.execute({ pattern: '**/*.ts', path: dir }, makeCtx());
    expect(result.output).toBe(path.join('src', 'nested', 'x.ts'));
  });

  it('sorts results for deterministic output', async () => {
    writeFileSync(path.join(dir, 'b.ts'), '', 'utf-8');
    writeFileSync(path.join(dir, 'a.ts'), '', 'utf-8');
    const result = await globTool.execute({ pattern: '*.ts', path: dir }, makeCtx());
    expect(result.output).toBe('a.ts\nb.ts');
  });

  it('returns "(no matches)" when nothing matches', async () => {
    const result = await globTool.execute({ pattern: '*.xyz', path: dir }, makeCtx());
    expect(result.output).toBe('(no matches)');
  });

  it('skips node_modules', async () => {
    mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules', 'x.ts'), '', 'utf-8');
    const result = await globTool.execute({ pattern: '**/*.ts', path: dir }, makeCtx());
    expect(result.output).toBe('(no matches)');
  });

  it('is marked read-only and concurrency-safe', () => {
    expect(globTool.isReadOnly).toBe(true);
    expect(globTool.isConcurrencySafe).toBe(true);
  });
});
