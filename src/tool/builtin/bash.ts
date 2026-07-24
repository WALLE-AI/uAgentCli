import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

import type { ToolDef } from '../types.js';
import { renderShellPrompt } from '../prompts/shell-template.js';

const execAsync = promisify(exec);

const paramsSchema = z.object({
  command: z.string().min(1),
  timeout: z.number().int().positive().optional(),
});

type BashParams = z.infer<typeof paramsSchema>;

function detectShell(): string {
  return process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL ?? '/bin/sh');
}

/**
 * 本迭代占位实现：直接调用 Node 子进程，不经过沙盒/权限网关
 * （exec-gateway 在迭代2 T2.7 接入，届时替换本文件的执行路径）。
 */
export const bashTool: ToolDef<BashParams> = {
  id: 'bash',
  description: renderShellPrompt({ os: process.platform, shell: detectShell(), cwd: process.cwd() }),
  parameters: paramsSchema,
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: true,
  execute: async (params, ctx) => {
    try {
      const { stdout, stderr } = await execAsync(params.command, {
        cwd: process.cwd(),
        timeout: params.timeout,
        signal: ctx.signal,
        maxBuffer: 10 * 1024 * 1024,
      });
      const output = stderr ? `${stdout}\n[stderr]\n${stderr}` : stdout;
      return { output };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      const err = error as { stdout?: string; stderr?: string; code?: number | string; message?: string };
      const parts = [err.stdout ?? '', err.stderr ? `[stderr]\n${err.stderr}` : '', `[exit code ${err.code ?? 'unknown'}]`];
      return {
        output: parts.filter(Boolean).join('\n'),
        metadata: { exitCode: err.code },
      };
    }
  },
};
