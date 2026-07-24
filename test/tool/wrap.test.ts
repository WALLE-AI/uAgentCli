import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toSessionID } from '../../src/types/ids.js';
import type { RunContext } from '../../src/types/abort.js';
import { wrap, MAX_LINES } from '../../src/tool/wrap.js';
import { InvalidArgumentsError, type ToolDef } from '../../src/tool/types.js';

function makeCtx(): RunContext {
  return {
    signal: new AbortController().signal,
    sessionID: toSessionID('sess-1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('sess-1') },
  };
}

describe('tool wrap()', () => {
  it('fail-closed: invalid params throw InvalidArgumentsError before execute runs', async () => {
    let executed = false;
    const def: ToolDef<{ path: string }> = {
      id: 'test-tool',
      description: 'test',
      parameters: z.object({ path: z.string() }),
      execute: async () => {
        executed = true;
        return { output: 'ok' };
      },
    };

    const wrapped = wrap(def);
    await expect(wrapped({ path: 123 }, makeCtx())).rejects.toBeInstanceOf(InvalidArgumentsError);
    expect(executed).toBe(false);
  });

  it('passes through small output untouched', async () => {
    const def: ToolDef<{}> = {
      id: 'small',
      description: 'test',
      parameters: z.object({}),
      execute: async () => ({ output: 'hello world' }),
    };
    const result = await wrap(def)({}, makeCtx());
    expect(result.output).toBe('hello world');
    expect(result.truncated).toBeUndefined();
  });

  it('truncates output exceeding MAX_LINES and records a metadata pointer', async () => {
    const bigOutput = Array.from({ length: MAX_LINES + 500 }, (_, i) => `line ${i}`).join('\n');
    const def: ToolDef<{}> = {
      id: 'big',
      description: 'test',
      parameters: z.object({}),
      execute: async () => ({ output: bigOutput }),
    };
    const result = await wrap(def)({}, makeCtx());
    expect(result.truncated).toBe(true);
    expect(result.output.split('\n').length).toBeLessThanOrEqual(MAX_LINES + 1);
    expect(result.metadata?.truncatedFile).toBeTypeOf('string');
  });

  it('untrustedOutput tools get fenced output; non-untrusted tools do not', async () => {
    const untrusted: ToolDef<{}> = {
      id: 'fetch',
      description: 'test',
      parameters: z.object({}),
      execute: async () => ({ output: 'external data' }),
      untrustedOutput: true,
    };
    const trusted: ToolDef<{}> = {
      id: 'read',
      description: 'test',
      parameters: z.object({}),
      execute: async () => ({ output: 'file contents' }),
    };

    const untrustedResult = await wrap(untrusted)({}, makeCtx());
    const trustedResult = await wrap(trusted)({}, makeCtx());

    expect(untrustedResult.output).toContain('<untrusted_external_content>');
    expect(untrustedResult.output).toContain('external data');
    expect(trustedResult.output).not.toContain('<untrusted_external_content>');
  });
});
