import type { ToolResultBlock, ToolUseBlock } from '../types/message.js';
import type { RunContext } from '../types/abort.js';
import type { ToolResult } from './types.js';

const DEFAULT_MAX_CONCURRENCY = 8;

export interface OrchestratorTool {
  call: ToolUseBlock;
  /** 默认 false：未声明视为不可与其他调用并发（写路径）。 */
  isConcurrencySafe?: boolean;
  /** 已知会被本次调用触碰的路径；未知（如 bash）时留空，按冲突处理。 */
  affectedPaths?: string[];
  run: (ctx: RunContext) => Promise<ToolResult>;
}

function pathsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) {
    // 未知触碰路径按 fail-closed 处理：视为与任何调用冲突，强制串行。
    return true;
  }
  const setA = new Set(a);
  return b.some((p) => setA.has(p));
}

function placeholder(toolUseId: string): ToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: '[interrupted]',
    is_error: true,
  };
}

async function runOne(
  item: { tool: OrchestratorTool; index: number },
  ctx: RunContext,
): Promise<ToolResultBlock> {
  if (ctx.signal.aborted) {
    return placeholder(item.tool.call.id);
  }

  try {
    const result = await item.tool.run(ctx);
    return {
      type: 'tool_result',
      tool_use_id: item.tool.call.id,
      content: result.output,
      is_error: false,
    };
  } catch (error) {
    return {
      type: 'tool_result',
      tool_use_id: item.tool.call.id,
      content: error instanceof Error ? error.message : String(error),
      is_error: true,
    };
  }
}

interface IndexedTool {
  tool: OrchestratorTool;
  index: number;
}

async function runConcurrentBatch(
  batch: IndexedTool[],
  ctx: RunContext,
  maxConcurrency: number,
): Promise<Map<number, ToolResultBlock>> {
  const results = new Map<number, ToolResultBlock>();
  const queue = [...batch];
  const running: Array<{ index: number; paths: string[]; promise: Promise<void> }> = [];

  while (queue.length > 0 || running.length > 0) {
    let launchedAny = false;
    for (let i = 0; i < queue.length; ) {
      const item = queue[i];
      const paths = item.tool.affectedPaths ?? [];
      const conflicts = running.some((r) => pathsOverlap(r.paths, paths));

      if (running.length < maxConcurrency && !conflicts) {
        queue.splice(i, 1);
        launchedAny = true;
        const entry: { index: number; paths: string[]; promise: Promise<void> } = {
          index: item.index,
          paths,
          promise: Promise.resolve(),
        };
        entry.promise = runOne(item, ctx).then((res) => {
          results.set(item.index, res);
          const pos = running.indexOf(entry);
          if (pos >= 0) {
            running.splice(pos, 1);
          }
        });
        running.push(entry);
      } else {
        i += 1;
      }
    }

    if (running.length > 0) {
      await Promise.race(running.map((r) => r.promise));
    } else if (!launchedAny && queue.length > 0) {
      // 理论上不可达（一切冲突都应随 running 清空而解除），防御性中断避免死循环。
      break;
    }
  }

  return results;
}

/**
 * §J 工具编排器：并发安全的调用（默认只读）批量并发执行，上限
 * `maxConcurrency`；非并发安全的调用（写/危险）严格串行；结果按原始
 * `tools` 顺序重排；`ctx.signal` abort 时，未执行/未完成的调用补占位
 * `tool_result` 维持 tool_use↔tool_result 配对。
 */
export async function runToolCalls(
  tools: OrchestratorTool[],
  ctx: RunContext,
  opts: { maxConcurrency?: number } = {},
): Promise<ToolResultBlock[]> {
  const maxConcurrency = opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const indexed: IndexedTool[] = tools.map((tool, index) => ({ tool, index }));
  const results = new Map<number, ToolResultBlock>();

  let i = 0;
  while (i < indexed.length) {
    const current = indexed[i];
    if (current.tool.isConcurrencySafe) {
      const batch: IndexedTool[] = [];
      while (i < indexed.length && indexed[i].tool.isConcurrencySafe) {
        batch.push(indexed[i]);
        i += 1;
      }
      const batchResults = await runConcurrentBatch(batch, ctx, maxConcurrency);
      for (const [idx, res] of batchResults) {
        results.set(idx, res);
      }
    } else {
      const res = await runOne(current, ctx);
      results.set(current.index, res);
      i += 1;
    }
  }

  return indexed.map(({ index }) => results.get(index)!);
}
