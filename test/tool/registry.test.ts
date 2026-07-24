import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolDef } from '../../src/tool/types.js';
import { ToolRegistry } from '../../src/tool/registry.js';
import type { Ruleset } from '../../src/permission/types.js';

function makeTool(id: string): ToolDef<{}> {
  return {
    id,
    description: id,
    parameters: z.object({}),
    execute: async () => ({ output: id }),
  };
}

describe('ToolRegistry', () => {
  it('registers and retrieves tools by id', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read'));
    expect(registry.get('read')?.id).toBe('read');
  });

  it('returns undefined for an unregistered tool', () => {
    const registry = new ToolRegistry();
    expect(registry.get('missing')).toBeUndefined();
  });

  it('re-registering the same id is idempotent (last one wins, no duplicate entries)', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read'));
    registry.register(makeTool('read'));
    expect(registry.getTools()).toHaveLength(1);
  });

  it('getTools() with no permCtx returns every registered tool', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read'));
    registry.register(makeTool('write'));
    expect(registry.getTools().map((t) => t.id).sort()).toEqual(['read', 'write']);
  });

  it('filters out tools whose action has a matching deny rule', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read'));
    registry.register(makeTool('write'));
    registry.register(makeTool('bash'));

    const ruleset: Ruleset = {
      rules: [{ action: 'write', pattern: '*', decision: 'deny' }],
    };

    const allowed = registry.getTools(ruleset).map((t) => t.id).sort();
    expect(allowed).toEqual(['bash', 'read']);
  });

  it('allows tools with no matching rule by default', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read'));
    const ruleset: Ruleset = { rules: [{ action: 'write', pattern: '*', decision: 'deny' }] };
    expect(registry.getTools(ruleset).map((t) => t.id)).toEqual(['read']);
  });

  it('T7.2 统一 evaluate：glob pattern deny 生效（旧 ad-hoc 匹配做不到）', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read')); // action read, id 'read'
    registry.register(makeTool('grep')); // action read, id 'grep'
    // 用 glob pattern 'gr*' deny：旧 isAllowed 只认 '*' 或精确 id，会漏；
    // 统一到 evaluate()+globMatch 后应正确命中 grep。
    const ruleset: Ruleset = { rules: [{ action: 'read', pattern: 'gr*', decision: 'deny' }] };
    expect(registry.getTools(ruleset).map((t) => t.id).sort()).toEqual(['read']);
  });

  it('T7.2 last-match-wins：后置 allow 覆盖前置 deny（与 evaluate 一致）', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('bash'));
    const ruleset: Ruleset = {
      rules: [
        { action: 'execute', pattern: '*', decision: 'deny' },
        { action: 'execute', pattern: 'bash', decision: 'allow' },
      ],
    };
    expect(registry.getTools(ruleset).map((t) => t.id)).toEqual(['bash']);
  });
});
