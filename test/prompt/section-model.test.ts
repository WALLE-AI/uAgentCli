import { describe, it, expect } from 'vitest';
import {
  assembleSections,
  renderSections,
  cacheablePrefix,
  lastCacheableIndex,
} from '../../src/prompt/section-model.js';

const base = {
  basePrompt: 'BASE',
  soulText: 'SOUL',
  projectDocText: 'DOC',
  skillsVerboseText: '<skills>\n- foo\n</skills>',
  mcpText: 'MCP',
};

describe('M0.5 section-model', () => {
  it('cacheable 段全部在 volatile 段之前（volatile-after-breakpoint 不变量）', () => {
    const secs = assembleSections({ ...base, envText: '<env>x</env>', memorySnapshotText: '<memory>m</memory>' });
    const lastCacheable = lastCacheableIndex(secs);
    secs.forEach((s, i) => {
      if (!s.cacheable) expect(i).toBeGreaterThan(lastCacheable);
    });
  });

  it('golden 不变量：只改 volatile(env/memory) → cacheable 前缀字节不变', () => {
    const a = assembleSections({ ...base, envText: '<env>AAA</env>', memorySnapshotText: '<memory>111</memory>' });
    const b = assembleSections({ ...base, envText: '<env>BBB</env>', memorySnapshotText: '<memory>222</memory>' });
    expect(cacheablePrefix(a)).toBe(cacheablePrefix(b));
    // 但整体渲染应不同（volatile 变了）
    expect(renderSections(a)).not.toBe(renderSections(b));
  });

  it('空技能 → 稳定占位 <skills>(none)</skills>，不消失（防断点漂移）', () => {
    const withSkills = assembleSections({ ...base });
    const noSkills = assembleSections({ ...base, skillsVerboseText: '' });
    // skills 段始终存在（cacheable 段数量相同）
    expect(withSkills.filter((s) => s.cacheable).length).toBe(noSkills.filter((s) => s.cacheable).length);
    expect(noSkills.find((s) => s.id === 'skills')?.text).toContain('(none)');
  });

  it('volatile 空 → 真跳过（env/memory/history 不出现）', () => {
    const secs = assembleSections({ ...base });
    expect(secs.find((s) => s.id === 'env')).toBeUndefined();
    expect(secs.find((s) => s.id === 'memory')).toBeUndefined();
    expect(secs.find((s) => s.id === 'history')).toBeUndefined();
  });

  it('渲染无双段：单次注入的 skills/env 各只出现一次', () => {
    const out = renderSections(
      assembleSections({ ...base, envText: '<env>E</env>', memorySnapshotText: '<memory>M</memory>' }),
    );
    expect(out.match(/<skills>/g)?.length).toBe(1);
    expect(out.match(/<env>/g)?.length).toBe(1);
    expect(out.match(/<memory>/g)?.length).toBe(1);
  });

  it('纯函数：相同输入字节稳定', () => {
    const input = { ...base, envText: '<env>E</env>' };
    expect(renderSections(assembleSections(input))).toBe(renderSections(assembleSections(input)));
  });
});
