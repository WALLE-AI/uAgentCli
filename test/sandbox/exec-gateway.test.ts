import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createFakeSpawn } from '../helpers/subprocess.js';
import { createAbortController } from '../helpers/abort.js';
import { ExecGateway } from '../../src/sandbox/exec-gateway.js';

describe('ExecGateway', () => {
  it('rejects a non-whitelisted executable without ever calling spawn', async () => {
    const { spawn, calls } = createFakeSpawn();
    const gateway = new ExecGateway({ spawnImpl: spawn });

    await expect(gateway.exec({ command: 'curl', args: ['http://evil.example'] })).rejects.toThrow(
      /allowlist/,
    );
    expect(calls).toEqual([]);
  });

  it('spawns a whitelisted executable and collects stdout/exit code', async () => {
    const { spawn, children } = createFakeSpawn();
    const gateway = new ExecGateway({ spawnImpl: spawn });

    const resultPromise = gateway.exec({ command: 'bash', args: ['-c', 'echo hi'] });
    const fakeChild = children[0];
    fakeChild.simulateStdout('hi\n');
    fakeChild.simulateExit(0);

    const result = await resultPromise;
    expect(result.stdout).toBe('hi\n');
    expect(result.exitCode).toBe(0);
  });

  it('kills the child process when the AbortSignal fires mid-run', async () => {
    const { spawn, children } = createFakeSpawn();
    const gateway = new ExecGateway({ spawnImpl: spawn });
    const controller = createAbortController();

    const resultPromise = gateway.exec({ command: 'bash', args: ['-c', 'sleep 5'], signal: controller.signal });
    const fakeChild = children[0];

    controller.abort();
    expect(fakeChild.killed).toBe(true);
    expect(fakeChild.killSignal).toBe('SIGTERM');

    const result = await resultPromise;
    expect(result.signal).toBe('SIGTERM');
  });

  it('kills immediately if the signal is already aborted before spawn resolves', async () => {
    const { spawn, children } = createFakeSpawn();
    const gateway = new ExecGateway({ spawnImpl: spawn });
    const controller = createAbortController();
    controller.abort();

    const resultPromise = gateway.exec({ command: 'bash', args: [], signal: controller.signal });
    expect(children[0].killed).toBe(true);
    await resultPromise;
  });

  it('scrubs secret environment variables before spawning', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-leak';
    try {
      const spawnSpy = vi.fn((_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
        return makeAutoExitingChild(options);
      });
      const gateway = new ExecGateway({ spawnImpl: spawnSpy as never });

      await gateway.exec({ command: 'bash', args: [] });

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const passedEnv = spawnSpy.mock.calls[0][2].env;
      expect(passedEnv?.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it('falls back sandbox mode to local execution without throwing', async () => {
    const { spawn, children } = createFakeSpawn();
    const gateway = new ExecGateway({ spawnImpl: spawn });

    const resultPromise = gateway.exec({ command: 'bash', args: [], mode: 'sandbox' });
    children[0].simulateExit(0);

    await expect(resultPromise).resolves.toMatchObject({ exitCode: 0 });
  });
});

function makeAutoExitingChild(_options: { env?: NodeJS.ProcessEnv }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  queueMicrotask(() => child.emit('exit', 0, null));
  return child;
}
