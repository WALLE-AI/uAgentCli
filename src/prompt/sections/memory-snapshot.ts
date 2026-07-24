import type { PromptSection } from '../types.js';

/**
 * 本迭代无真实记忆检索（迭代3 T3.8 实现），先给固定占位结构，
 * 用 <system-reminder>/<memory> 数据标签包裹，避免被误当作指令。
 */
function computeMemorySnapshot(): string {
  return [
    '<system-reminder>',
    '<memory>',
    '(no memory entries retrieved this turn)',
    '</memory>',
    '</system-reminder>',
  ].join('\n');
}

export const memorySnapshotSection: PromptSection = {
  name: 'memory-snapshot',
  tier: 'volatile',
  cacheable: false,
  compute: computeMemorySnapshot,
};
