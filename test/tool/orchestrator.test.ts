import { describe, expect, it } from 'vitest';
import { toSessionID } from '../../src/types/ids.js';
import type { RunContext } from '../../src/types/abort.js';
import type { ToolUseBlock } from '../../src/types/message.js';
import { runToolCalls, type OrchestratorTool } from '../../src/tool/orchestrator.js';

function makeCtx(signal?: AbortSignal): RunContext {
  return {
    signal: signal ?? new AbortController().signal,
    sessionID: toSessionID('sess-1'),
    depth: 0,
    permission: { mode: 'default', sessionID: toSessionID('sess-1') },
  };
}

function call(id: string): ToolUseBlock {
  return { type: 'tool_use', id, name: 'test', input: {} };
}

describe('tool orchestrator', () => {
  it('runs concurrency-safe calls concurrently, capped at maxConcurrency', async () => {
    let concurrent = 0;
    let maxObserved = 0;
    const makeTool = (id: string): OrchestratorTool => ({
      call: call(id),
      isConcurrencySafe: true,
      affectedPaths: [`/read/${id}`],
      run: async () => {
        concurrent += 1;
        maxObserved = Math.max(maxObserved, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent -= 1;
        return { output: `result-${id}` };
      },
    });

    const tools = Array.from({ length: 12 }, (_, i) => makeTool(`c${i}`));
    await runToolCalls(tools, makeCtx(), { maxConcurrency: 3 });
    expect(maxObserved).toBeLessThanOrEqual(3);
    expect(maxObserved).toBeGreaterThan(1);
  });

  it('never runs non-concurrency-safe (write) calls at the same time', async () => {
    let concurrent = 0;
    let maxObserved = 0;
    const makeWrite = (id: string): OrchestratorTool => ({
      call: call(id),
      isConcurrencySafe: false,
      run: async () => {
        concurrent += 1;
        maxObserved = Math.max(maxObserved, concurrent);
        await new Promise((r) => setTimeout(r, 2));
        concurrent -= 1;
        return { output: `write-${id}` };
      },
    });

    const tools = Array.from({ length: 5 }, (_, i) => makeWrite(`w${i}`));
    await runToolCalls(tools, makeCtx());
    expect(maxObserved).toBe(1);
  });

  it('serializes concurrency-safe calls that share overlapping affected paths', async () => {
    let concurrent = 0;
    let maxObserved = 0;
    const order: string[] = [];
    const makeTool = (id: string, paths: string[]): OrchestratorTool => ({
      call: call(id),
      isConcurrencySafe: true,
      affectedPaths: paths,
      run: async () => {
        concurrent += 1;
        maxObserved = Math.max(maxObserved, concurrent);
        order.push(`start-${id}`);
        await new Promise((r) => setTimeout(r, 5));
        concurrent -= 1;
        order.push(`end-${id}`);
        return { output: id };
      },
    });

    const tools = [
      makeTool('a', ['/x/file.txt']),
      makeTool('b', ['/x/file.txt']),
      makeTool('c', ['/y/other.txt']),
    ];
    await runToolCalls(tools, makeCtx(), { maxConcurrency: 8 });
    // a and b share a path, so they must never overlap.
    const aStart = order.indexOf('start-a');
    const aEnd = order.indexOf('end-a');
    const bStart = order.indexOf('start-b');
    expect(bStart > aEnd || aStart > order.indexOf('end-b')).toBe(true);
  });

  it('reorders results to match the original tool_use call order', async () => {
    const tools: OrchestratorTool[] = [
      {
        call: call('fast'),
        isConcurrencySafe: true,
        affectedPaths: ['/a'],
        run: async () => {
          await new Promise((r) => setTimeout(r, 1));
          return { output: 'fast-result' };
        },
      },
      {
        call: call('slow'),
        isConcurrencySafe: true,
        affectedPaths: ['/b'],
        run: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return { output: 'slow-result' };
        },
      },
    ];

    const results = await runToolCalls(tools, makeCtx(), { maxConcurrency: 8 });
    expect(results.map((r) => r.tool_use_id)).toEqual(['fast', 'slow']);
  });

  it('fills a placeholder tool_result for calls when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const tools: OrchestratorTool[] = [
      {
        call: call('a'),
        isConcurrencySafe: false,
        run: async () => ({ output: 'should not run' }),
      },
    ];

    const results = await runToolCalls(tools, makeCtx(controller.signal));
    expect(results).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: '[interrupted]', is_error: true },
    ]);
  });
});
