import { describe, expect, it } from 'vitest';
import type { ContentBlock, Message } from '../../src/types/message.js';
import type { RunContext } from '../../src/types/abort.js';
import type { Ruleset } from '../../src/permission/types.js';
import type { ContextSection } from '../../src/context/types.js';
import { toSessionID } from '../../src/types/ids.js';

/**
 * 这些模块目前只导出类型（迭代0 占位），本测试只是把它们纳入类型检查面，
 * 保证互相引用不产生循环依赖，也保证编译产物不因未使用而被 tree-shake 掉。
 */
describe('type-only module wiring', () => {
  it('Message/ContentBlock/RunContext/Ruleset/ContextSection compose without circular deps', () => {
    const block: ContentBlock = { type: 'text', text: 'hi' };
    const message: Message = { role: 'user', content: [block], seq: 1 };

    const ruleset: Ruleset = { rules: [] };
    const section: ContextSection = { name: 'identity', tier: 'stable', cacheable: true };

    const ctx: RunContext = {
      signal: new AbortController().signal,
      sessionID: toSessionID('sess-1'),
      depth: 0,
      permission: { mode: 'default', sessionID: toSessionID('sess-1') },
    };

    expect(message.content).toHaveLength(1);
    expect(ruleset.rules).toHaveLength(0);
    expect(section.tier).toBe('stable');
    expect(ctx.depth).toBe(0);
  });
});
