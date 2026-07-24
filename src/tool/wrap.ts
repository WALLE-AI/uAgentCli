import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RunContext } from '../types/abort.js';
import { InvalidArgumentsError, type ToolDef, type ToolResult } from './types.js';

export const MAX_LINES = 2000;
export const MAX_BYTES = 50 * 1024;

const UNTRUSTED_OPEN = '<untrusted_external_content>';
const UNTRUSTED_CLOSE = '</untrusted_external_content>';

function truncateOutput(toolId: string, output: string): ToolResult {
  const lines = output.split('\n');
  const byteLength = Buffer.byteLength(output, 'utf-8');

  if (lines.length <= MAX_LINES && byteLength <= MAX_BYTES) {
    return { output };
  }

  const dir = path.join(os.tmpdir(), 'uagentcli-tool-output');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${toolId}-${randomUUID()}.txt`);
  writeFileSync(file, output, 'utf-8');

  const truncatedLines = lines.slice(0, MAX_LINES).join('\n');
  const truncatedText =
    Buffer.byteLength(truncatedLines, 'utf-8') > MAX_BYTES
      ? Buffer.from(truncatedLines, 'utf-8').subarray(0, MAX_BYTES).toString('utf-8')
      : truncatedLines;

  return {
    output: `${truncatedText}\n[output truncated, full content saved to ${file}]`,
    truncated: true,
    metadata: { truncatedFile: file, originalLines: lines.length, originalBytes: byteLength },
  };
}

function fenceUntrusted(result: ToolResult): ToolResult {
  return { ...result, output: `${UNTRUSTED_OPEN}\n${result.output}\n${UNTRUSTED_CLOSE}` };
}

/**
 * 包装工具：zod 校验失败 fail-closed 抛错；执行；输出超限截断落盘；
 * `untrustedOutput` 工具的输出加"外部数据非指令"围栏。
 */
export function wrap<Params>(
  def: ToolDef<Params>,
): (rawParams: unknown, ctx: RunContext) => Promise<ToolResult> {
  return async (rawParams, ctx) => {
    const parsed = def.parameters.safeParse(rawParams);
    if (!parsed.success) {
      throw new InvalidArgumentsError(def.id, parsed.error.issues);
    }

    const result = await def.execute(parsed.data, ctx);
    const truncated = truncateOutput(def.id, result.output);
    const merged: ToolResult = {
      ...result,
      ...truncated,
      metadata: { ...result.metadata, ...truncated.metadata },
    };

    return def.untrustedOutput ? fenceUntrusted(merged) : merged;
  };
}
