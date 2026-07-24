import { vi } from 'vitest';

/**
 * 冻结时钟 helper：用于验证 prompt section / cache-policy 等
 * "日期只到天、跨小时分钟仍字节稳定"的场景。
 */
export function freeze(date: Date | string | number): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(date));
}

export function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

export function unfreeze(): void {
  vi.useRealTimers();
}
