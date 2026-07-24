import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toSessionID } from '../../../src/types/ids.js';
import type { RunContext } from '../../../src/types/abort.js';
import { editTool } from '../../../src/tool/builtin/edit.js';

function makeCtx(): RunContext {
  return {
    signal: new AbortController().signal,
    sessionID: toSessionID('sess-1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('sess-1') },
  };
}

describe('edit tool', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'uagentcli-edit-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces a unique occurrence', async () => {
    const file = path.join(dir, 'a.txt');
    writeFileSync(file, 'hello world', 'utf-8');
    await editTool.execute({ file_path: file, old_string: 'world', new_string: 'there' }, makeCtx());
    expect(readFileSync(file, 'utf-8')).toBe('hello there');
  });

  it('throws when old_string is not found', async () => {
    const file = path.join(dir, 'a.txt');
    writeFileSync(file, 'hello world', 'utf-8');
    await expect(
      editTool.execute({ file_path: file, old_string: 'missing', new_string: 'x' }, makeCtx()),
    ).rejects.toThrow(/not found/);
  });

  it('throws when old_string is ambiguous without replace_all', async () => {
    const file = path.join(dir, 'a.txt');
    writeFileSync(file, 'foo foo foo', 'utf-8');
    await expect(
      editTool.execute({ file_path: file, old_string: 'foo', new_string: 'bar' }, makeCtx()),
    ).rejects.toThrow(/not unique/);
  });

  it('replaces all occurrences when replace_all is set', async () => {
    const file = path.join(dir, 'a.txt');
    writeFileSync(file, 'foo foo foo', 'utf-8');
    await editTool.execute(
      { file_path: file, old_string: 'foo', new_string: 'bar', replace_all: true },
      makeCtx(),
    );
    expect(readFileSync(file, 'utf-8')).toBe('bar bar bar');
  });
});
