import { EventEmitter } from 'node:events';

/**
 * 假子进程 helper：用于 exec-gateway（迭代2 T2.7）的确定性单测——
 * 验证 AbortSignal 穿透到 kill()、PATH 白名单拒绝等场景，不启动真实进程。
 */
export class FakeChildProcess extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public killed = false;
  public killSignal: NodeJS.Signals | undefined;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.killSignal = signal;
    this.emit('exit', null, signal ?? 'SIGTERM');
    return true;
  }

  /** 测试驱动：模拟进程正常退出。 */
  simulateExit(code: number): void {
    this.emit('exit', code, null);
  }

  simulateStdout(chunk: string): void {
    this.stdout.emit('data', Buffer.from(chunk));
  }

  simulateStderr(chunk: string): void {
    this.stderr.emit('data', Buffer.from(chunk));
  }
}

export type FakeSpawn = (command: string, args: string[]) => FakeChildProcess;

export function createFakeSpawn(): {
  spawn: FakeSpawn;
  calls: Array<{ command: string; args: string[] }>;
  children: FakeChildProcess[];
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const children: FakeChildProcess[] = [];
  const spawn: FakeSpawn = (command, args) => {
    calls.push({ command, args });
    const child = new FakeChildProcess();
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}
