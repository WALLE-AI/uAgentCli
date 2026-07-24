/**
 * 可编排 AbortSignal 注入 helper：用于逐层 abort 单测
 * （provider / orchestrator / exec-gateway / tool.execute 各注入点）。
 */
export function createAbortController(): AbortController {
  return new AbortController();
}

/** 调用 n 次某回调后自动 abort，用于模拟"运行到第 n 步中断"。 */
export function abortAfterCalls(controller: AbortController, n: number): () => void {
  let count = 0;
  return () => {
    count += 1;
    if (count >= n) {
      controller.abort();
    }
  };
}

export function abortAfterMs(controller: AbortController, ms: number): void {
  setTimeout(() => controller.abort(), ms);
}
