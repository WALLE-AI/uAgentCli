import type { PromptSection } from './types.js';

/**
 * §D 缓存纪律：`cache_control` 断点只应打在"可缓存段落跑到头"的位置——
 * 从头开始的连续 cacheable 段落末尾。一旦遇到不可缓存（volatile）段落，
 * 该运行段结束，后续任何 cacheable 段都不再获得新断点（Anthropic 的
 * 前缀缓存要求断点位置在多轮之间保持稳定，不能随内容抖动）。
 *
 * 返回值：应打断点的 section 下标数组（相对于传入的 `sections` 顺序）。
 */
export function resolveCacheBreakpoints(sections: PromptSection[]): number[] {
  const breakpoints: number[] = [];

  for (let i = 0; i < sections.length; i += 1) {
    if (!sections[i].cacheable) {
      break;
    }
    const nextIsCacheable = i + 1 < sections.length && sections[i + 1].cacheable;
    if (!nextIsCacheable) {
      breakpoints.push(i);
    }
  }

  return breakpoints;
}
