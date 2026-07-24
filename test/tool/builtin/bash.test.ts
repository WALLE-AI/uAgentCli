import { describe, expect, it } from 'vitest';
import { toSessionID } from '../../../src/types/ids.js';
import type { RunContext } from '../../../src/types/abort.js';
import { bashTool } from '../../../src/tool/builtin/bash.js';

function makeCtx(signal?: AbortSignal): RunContext {
  return {
    signal: signal ?? new AbortController().signal,
    sessionID: toSessionID('sess-1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('sess-1') },
  };
}

describe('bash tool', () => {
  it('captures stdout from a successful command', async () => {
    const result = await bashTool.execute({ command: 'echo hello' }, makeCtx());
    expect(result.output.trim()).toBe('hello');
  });

  it('surfaces a non-zero exit code without throwing', async () => {
    const result = await bashTool.execute({ command: 'exit 3' }, makeCtx());
    expect(result.metadata?.exitCode).toBe(3);
  });

  it('is killed when ctx.signal aborts mid-run', async () => {
    const controller = new AbortController();
    const run = bashTool.execute({ command: 'sleep 5' }, makeCtx(controller.signal));
    setTimeout(() => controller.abort(), 20);
    await expect(run).rejects.toThrow();
  });

  it('is marked fail-closed by default (not read-only, not concurrency-safe, destructive)', () => {
    expect(bashTool.isReadOnly).toBe(false);
    expect(bashTool.isConcurrencySafe).toBe(false);
    expect(bashTool.isDestructive).toBe(true);
  });
});
