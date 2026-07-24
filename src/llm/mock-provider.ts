import type { LlmEvent, LlmProvider, LlmRequest } from './types.js';

/**
 * 确定性 mock provider：忽略 request 内容，按预设序列吐事件——最高风险的
 * run-loop 代码必须先能用它不烧 token、确定性地测（§I）。每次 yield 前
 * 检查 `signal.aborted`，命中则提前结束（与 `test/helpers/replay.ts` 的
 * `replayEvents` 同款模式）。
 */
export function createMockProvider(events: LlmEvent[]): LlmProvider {
  return {
    async *streamChat(_request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
      for (const event of events) {
        if (signal.aborted) {
          return;
        }
        yield event;
      }
    },
  };
}
