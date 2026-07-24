import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';

import { scrubEnv } from '../security/env-scrub.js';
import type { ExecutionMode } from './types.js';

export interface ChildProcessLike {
  stdout: { on(event: 'data', cb: (chunk: Buffer | string) => void): void };
  stderr: { on(event: 'data', cb: (chunk: Buffer | string) => void): void };
  on(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface SpawnOptionsLike {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export type SpawnImpl = (command: string, args: string[], options: SpawnOptionsLike) => ChildProcessLike;

export interface ExecRequest {
  command: string;
  args?: string[];
  cwd?: string;
  signal?: AbortSignal;
  mode?: ExecutionMode;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

const DEFAULT_ALLOWED_EXECUTABLES = new Set(['bash', 'sh', 'zsh', 'cmd.exe', 'powershell.exe']);

export interface ExecGatewayOptions {
  allowedExecutables?: Set<string>;
  spawnImpl?: SpawnImpl;
}

/**
 * §四 唯一子进程 Builder：`bash` 工具（以及未来任何需要派生子进程的
 * 工具）都必须经过这里，不允许在别处裸调用 `child_process.spawn`。
 * - PATH 白名单：拒绝不在白名单里的可执行文件。
 * - `signal` abort → `child.kill()`。
 * - 派生前调用 `env-scrub` 处理传给子进程的环境变量副本。
 * - `sandbox` 模式本迭代降级为 local（无真实容器/命名空间隔离，
 *   由调用方的权限层强制走 ask，这里只负责标注/透传 mode）。
 */
export class ExecGateway {
  private readonly allowed: Set<string>;
  private readonly spawnImpl: SpawnImpl;

  constructor(options: ExecGatewayOptions = {}) {
    this.allowed = options.allowedExecutables ?? DEFAULT_ALLOWED_EXECUTABLES;
    this.spawnImpl = options.spawnImpl ?? (nodeSpawn as unknown as SpawnImpl);
  }

  exec(request: ExecRequest): Promise<ExecResult> {
    const executableName = path.basename(request.command);
    if (!this.allowed.has(executableName)) {
      return Promise.reject(
        new Error(`Executable "${request.command}" is not in the exec-gateway allowlist`),
      );
    }

    const env = scrubEnv(process.env);

    return new Promise((resolve, reject) => {
      let child: ChildProcessLike;
      try {
        child = this.spawnImpl(request.command, request.args ?? [], { cwd: request.cwd, env });
      } catch (error) {
        reject(error);
        return;
      }

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const onAbort = () => {
        child.kill('SIGTERM');
      };
      request.signal?.addEventListener('abort', onAbort);

      child.on('exit', (code, signal) => {
        request.signal?.removeEventListener('abort', onAbort);
        resolve({ stdout, stderr, exitCode: code, signal });
      });

      if (request.signal?.aborted) {
        onAbort();
      }
    });
  }
}
