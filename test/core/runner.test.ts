import { describe, expect, it, vi } from 'vitest';
import { Runner } from '../../src/core/runner.js';
import { SessionRunState } from '../../src/core/session-run-state.js';
import { toSessionID } from '../../src/types/ids.js';

function deferredWork<T>(): { work: () => Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { work: () => promise, resolve, reject };
}

describe('Runner state machine', () => {
  it('idle -> running -> idle on a normal run', async () => {
    const runner = new Runner();
    expect(runner.getState()).toBe('idle');

    const { work, resolve } = deferredWork<string>();
    const runPromise = runner.ensureRunning(work);
    expect(runner.getState()).toBe('running');

    resolve('done');
    await expect(runPromise).resolves.toBe('done');
    expect(runner.getState()).toBe('idle');
  });

  it('idle -> shell -> idle when no run is queued', async () => {
    const runner = new Runner();
    const { work, resolve } = deferredWork<string>();
    const shellPromise = runner.runShell(work);
    expect(runner.getState()).toBe('shell');

    resolve('shell done');
    await expect(shellPromise).resolves.toBe('shell done');
    expect(runner.getState()).toBe('idle');
  });

  it('shell -> shellThenRun -> running -> idle when a run is queued during shell', async () => {
    const runner = new Runner();
    const shell = deferredWork<string>();
    const run = deferredWork<string>();

    const shellPromise = runner.runShell(shell.work);
    expect(runner.getState()).toBe('shell');

    const runPromise = runner.ensureRunning(run.work);
    expect(runner.getState()).toBe('shellThenRun');

    shell.resolve('shell done');
    await shellPromise;
    expect(runner.getState()).toBe('running');

    run.resolve('run done');
    await expect(runPromise).resolves.toBe('run done');
    expect(runner.getState()).toBe('idle');
  });

  it('runShell throws if called while not idle', async () => {
    const runner = new Runner();
    const { work, resolve } = deferredWork<string>();
    runner.ensureRunning(work);
    expect(() => runner.runShell(() => Promise.resolve('x'))).toThrow();
    resolve('done');
  });

  it('steering: a second ensureRunning call while running does NOT start a new run, it attaches to the in-flight one', async () => {
    const runner = new Runner();
    const workFn = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve('single result'), 5)));

    const first = runner.ensureRunning(workFn);
    expect(runner.getState()).toBe('running');

    // Simulate "appending a message mid-run": call ensureRunning again.
    const second = runner.ensureRunning(workFn);

    expect(workFn).toHaveBeenCalledTimes(1); // no second run started
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe('single result');
    expect(secondResult).toBe('single result');
  });

  it('ensureRunning is idempotent while shellThenRun: repeated calls return the same queued promise', async () => {
    const runner = new Runner();
    const shell = deferredWork<string>();
    const runWorkFn = vi.fn(() => Promise.resolve('run result'));

    runner.runShell(shell.work);
    const first = runner.ensureRunning(runWorkFn);
    const second = runner.ensureRunning(runWorkFn);

    expect(runWorkFn).toHaveBeenCalledTimes(0); // not started until shell finishes
    shell.resolve('shell done');

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe('run result');
    expect(secondResult).toBe('run result');
    expect(runWorkFn).toHaveBeenCalledTimes(1);
  });

  it('propagates rejection from a run back to ensureRunning callers', async () => {
    const runner = new Runner();
    const { work, reject } = deferredWork<string>();
    const runPromise = runner.ensureRunning(work);
    reject(new Error('boom'));
    await expect(runPromise).rejects.toThrow('boom');
    expect(runner.getState()).toBe('idle');
  });
});

describe('SessionRunState single-flight', () => {
  it('returns the same Runner instance for repeated calls with the same sessionID', () => {
    const state = new SessionRunState();
    const id = toSessionID('s1');
    const a = state.getRunner(id);
    const b = state.getRunner(id);
    expect(a).toBe(b);
  });

  it('creates distinct Runner instances for different sessionIDs', () => {
    const state = new SessionRunState();
    const a = state.getRunner(toSessionID('s1'));
    const b = state.getRunner(toSessionID('s2'));
    expect(a).not.toBe(b);
  });

  it('concurrent ensureRunning calls on the same session do not double-start work', async () => {
    const state = new SessionRunState();
    const id = toSessionID('s1');
    const workFn = vi.fn(() => Promise.resolve('ok'));

    const [a, b] = await Promise.all([
      state.getRunner(id).ensureRunning(workFn),
      state.getRunner(id).ensureRunning(workFn),
    ]);

    expect(workFn).toHaveBeenCalledTimes(1);
    expect(a).toBe('ok');
    expect(b).toBe('ok');
  });
});
