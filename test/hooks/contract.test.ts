import { describe, expect, it } from 'vitest';
import { HookRegistry } from '../../src/hooks/registry.js';
import type { HookPermissionDecision } from '../../src/hooks/types.js';
import { checkToolPermission } from '../../src/permission/gate.js';

describe('HookRegistry contract', () => {
  it('the permissionDecision enum covers exactly allow/deny/ask', () => {
    const decisions: HookPermissionDecision[] = ['allow', 'deny', 'ask'];
    expect(decisions).toEqual(['allow', 'deny', 'ask']);
  });

  it('register()/list() are real behavior: registered hooks are listed under their event', () => {
    const registry = new HookRegistry();
    const preHook = { event: 'PreToolUse' as const, handle: () => ({ permissionDecision: 'allow' as const }) };
    const postHook = { event: 'PostToolUse' as const, handle: () => ({}) };
    registry.register(preHook);
    registry.register(postHook);

    expect(registry.list('PreToolUse')).toEqual([preHook]);
    expect(registry.list('PostToolUse')).toEqual([postHook]);
  });

  it('run() with no registered hooks for the event returns an empty result', async () => {
    const registry = new HookRegistry();
    expect(await registry.run({ event: 'PreToolUse', toolId: 'bash', sessionID: 's1' })).toEqual({});
  });

  it('run() surfaces a single hook\'s permissionDecision', async () => {
    const registry = new HookRegistry();
    registry.register({ event: 'PreToolUse', handle: () => ({ permissionDecision: 'ask' }) });
    expect(await registry.run({ event: 'PreToolUse', toolId: 'bash', sessionID: 's1' })).toEqual({
      permissionDecision: 'ask',
    });
  });

  it('run() merges multiple hooks with deny > ask > allow precedence', async () => {
    const registry = new HookRegistry();
    registry.register({ event: 'PreToolUse', handle: () => ({ permissionDecision: 'allow' }) });
    registry.register({ event: 'PreToolUse', handle: () => ({ permissionDecision: 'ask' }) });
    registry.register({ event: 'PreToolUse', handle: () => ({ permissionDecision: 'deny' }) });
    expect(await registry.run({ event: 'PreToolUse', toolId: 'bash', sessionID: 's1' })).toEqual({
      permissionDecision: 'deny',
    });
  });

  it('run() awaits async hook handlers', async () => {
    const registry = new HookRegistry();
    registry.register({
      event: 'PreToolUse',
      handle: async () => {
        await Promise.resolve();
        return { permissionDecision: 'deny' as const };
      },
    });
    expect(await registry.run({ event: 'PreToolUse', toolId: 'bash', sessionID: 's1' })).toEqual({
      permissionDecision: 'deny',
    });
  });

  it('run() only considers hooks registered for the matching event', async () => {
    const registry = new HookRegistry();
    registry.register({ event: 'PostToolUse', handle: () => ({ permissionDecision: 'deny' }) });
    expect(await registry.run({ event: 'PreToolUse', toolId: 'bash', sessionID: 's1' })).toEqual({});
  });

  it('gate.ts remains the sole permission decision source regardless of hook registration', () => {
    const registry = new HookRegistry();
    registry.register({
      event: 'PreToolUse',
      handle: () => ({ permissionDecision: 'deny' as const }),
    });

    // checkToolPermission()'s signature has no hooks/registry parameter at all —
    // registering a hook that "would" deny has zero effect on the gate's own decision.
    // (Real wiring lives in core/run-loop.ts, which calls HookRegistry.run() itself
    // and tightens the gate's decision after the fact — see run-loop.unit.test.ts.)
    const decision = checkToolPermission({
      action: 'read',
      pattern: 'read',
      mode: 'default',
      ruleset: { rules: [{ action: 'read', pattern: 'read', decision: 'allow' }] },
      approved: { rules: [] },
    });
    expect(decision).toBe('allow');
  });
});
