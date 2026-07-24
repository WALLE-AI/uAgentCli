import { describe, expect, it } from 'vitest';
import { toSessionID } from '../../src/types/ids.js';
import { PermissionManager } from '../../src/permission/manager.js';
import { handleReply, type ApprovedStore } from '../../src/permission/reply.js';

describe('handleReply', () => {
  it('once: resolves the request but does not persist an approved rule', async () => {
    const manager = new PermissionManager();
    const approved: ApprovedStore = { rules: [] };
    const promise = manager.ask({ id: 'r1', sessionID: toSessionID('s1'), action: 'write', patterns: ['a.txt'] });

    handleReply(manager, approved, { requestID: 'r1', reply: 'once' });

    await expect(promise).resolves.toBe('allow');
    expect(approved.rules).toEqual([]);
  });

  it('always: persists an allow rule and settles the request', async () => {
    const manager = new PermissionManager();
    const approved: ApprovedStore = { rules: [] };
    const promise = manager.ask({ id: 'r1', sessionID: toSessionID('s1'), action: 'write', patterns: ['a.txt'] });

    handleReply(manager, approved, { requestID: 'r1', reply: 'always' });

    await expect(promise).resolves.toBe('allow');
    expect(approved.rules).toEqual([{ action: 'write', pattern: 'a.txt', decision: 'allow' }]);
  });

  it('always cascades: other same-session pending requests fully covered by the new rule auto-settle', async () => {
    const manager = new PermissionManager();
    const approved: ApprovedStore = { rules: [] };
    const session = toSessionID('s1');

    const p1 = manager.ask({ id: 'r1', sessionID: session, action: 'write', patterns: ['dir/*'] });
    const p2 = manager.ask({ id: 'r2', sessionID: session, action: 'write', patterns: ['dir/foo.txt'] });
    const p3 = manager.ask({ id: 'r3', sessionID: session, action: 'read', patterns: ['dir/foo.txt'] });

    handleReply(manager, approved, { requestID: 'r1', reply: 'always', always: ['dir/*'] });

    await expect(p1).resolves.toBe('allow');
    // r2's pattern is covered by the new "dir/*" allow rule -> auto-approved
    await expect(p2).resolves.toBe('allow');
    // r3 is a different action (read vs write) -> not covered, stays pending
    expect(manager.has('r3')).toBe(true);
    void p3;
  });

  it('always cascade does not cross session boundaries', async () => {
    const manager = new PermissionManager();
    const approved: ApprovedStore = { rules: [] };

    void manager.ask({ id: 'r1', sessionID: toSessionID('s1'), action: 'write', patterns: ['dir/*'] });
    void manager.ask({ id: 'r2', sessionID: toSessionID('s2'), action: 'write', patterns: ['dir/foo.txt'] });

    handleReply(manager, approved, { requestID: 'r1', reply: 'always', always: ['dir/*'] });

    expect(manager.has('r2')).toBe(true);
  });

  it('reject: denies the request and cascades deny to same-session pending', async () => {
    const manager = new PermissionManager();
    const approved: ApprovedStore = { rules: [] };
    const session = toSessionID('s1');

    const p1 = manager.ask({ id: 'r1', sessionID: session, action: 'write', patterns: ['a.txt'] });
    const p2 = manager.ask({ id: 'r2', sessionID: session, action: 'write', patterns: ['b.txt'] });
    const p3 = manager.ask({ id: 'r3', sessionID: toSessionID('other'), action: 'write', patterns: ['c.txt'] });

    handleReply(manager, approved, { requestID: 'r1', reply: 'reject' });

    await expect(p1).resolves.toBe('deny');
    await expect(p2).resolves.toBe('deny');
    expect(manager.has('r3')).toBe(true);
    void p3;
  });

  it('is a no-op when the requestID no longer exists (already settled elsewhere)', () => {
    const manager = new PermissionManager();
    const approved: ApprovedStore = { rules: [] };
    expect(() => handleReply(manager, approved, { requestID: 'missing', reply: 'always' })).not.toThrow();
    expect(approved.rules).toEqual([]);
  });
});
