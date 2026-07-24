export type RunnerStateTag = 'idle' | 'running' | 'shell' | 'shellThenRun';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type Work<T> = () => Promise<T>;

/**
 * §C 手写 4 态状态机，移植自 OpenCode `effect/runner.ts` 的语义
 * （Idle/Running/Shell/ShellThenRun），用原生 Promise 代替 Effect-TS 的
 * Deferred/Fiber。核心不变式："running 态下再次 ensureRunning 绝不启动
 * 第二个 run"——这就是 steering（转向）而非"取消+重启"的落地方式：
 * 调用方负责把新消息写进历史，run-loop 内层下一轮自然读到。
 *
 * `shell`/`shellThenRun` 本迭代没有真实的交互式 shell 功能绑定，只用
 * `runShell()` 承载通用的非 run 型异步工作，保留状态转移语义完整可测。
 */
export class Runner {
  private tag: RunnerStateTag = 'idle';
  private runDeferred: Deferred<unknown> | null = null;
  private pendingRunWork: Work<unknown> | null = null;
  private pendingRunDeferred: Deferred<unknown> | null = null;

  getState(): RunnerStateTag {
    return this.tag;
  }

  ensureRunning(work: Work<unknown>): Promise<unknown> {
    if (this.tag === 'idle') {
      return this.startRun(work);
    }
    if (this.tag === 'running') {
      // steering: 不启动第二个 run，直接挂到已有 run 的完成上。
      return this.runDeferred!.promise;
    }
    if (this.tag === 'shell') {
      const deferred = createDeferred<unknown>();
      this.pendingRunWork = work;
      this.pendingRunDeferred = deferred;
      this.tag = 'shellThenRun';
      return deferred.promise;
    }
    // shellThenRun：幂等，已经登记过一个等待中的 run。
    return this.pendingRunDeferred!.promise;
  }

  runShell(work: Work<unknown>): Promise<unknown> {
    if (this.tag !== 'idle') {
      throw new Error(`runShell: cannot start a shell task while in state "${this.tag}"`);
    }
    const deferred = createDeferred<unknown>();
    this.tag = 'shell';
    work().then(
      (value) => this.finishShell(deferred, () => deferred.resolve(value)),
      (error) => this.finishShell(deferred, () => deferred.reject(error)),
    );
    return deferred.promise;
  }

  private startRun(work: Work<unknown>): Promise<unknown> {
    const deferred = createDeferred<unknown>();
    this.runDeferred = deferred;
    this.tag = 'running';
    work().then(
      (value) => this.finishRun(() => deferred.resolve(value)),
      (error) => this.finishRun(() => deferred.reject(error)),
    );
    return deferred.promise;
  }

  private finishRun(settle: () => void): void {
    this.runDeferred = null;
    this.tag = 'idle';
    settle();
  }

  private finishShell(_shellDeferred: Deferred<unknown>, settleShell: () => void): void {
    settleShell();
    if (this.tag === 'shellThenRun' && this.pendingRunWork && this.pendingRunDeferred) {
      const work = this.pendingRunWork;
      const runDeferred = this.pendingRunDeferred;
      this.pendingRunWork = null;
      this.pendingRunDeferred = null;
      this.runDeferred = runDeferred;
      this.tag = 'running';
      work().then(
        (value) => this.finishRun(() => runDeferred.resolve(value)),
        (error) => this.finishRun(() => runDeferred.reject(error)),
      );
    } else {
      this.tag = 'idle';
    }
  }
}
