import { describe, expect, it } from 'vitest';
import { toSessionID } from '../../src/types/ids.js';
import { PermissionManager } from '../../src/permission/manager.js';

describe('PermissionManager', () => {
  it('ask() resolves only once settle() is called', async () => {
    const manager = new PermissionManager();
    const promise = manager.ask({
      id: 'req-1',
      sessionID: toSessionID('s1'),
      action: 'write',
      patterns: ['file.txt'],
    });

    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    manager.settle('req-1', 'allow');
    await expect(promise).resolves.toBe('allow');
  });

  it('settle() is idempotent: second settle on the same id is a no-op, does not throw', () => {
    const manager = new PermissionManager();
    void manager.ask({ id: 'req-1', sessionID: toSessionID('s1'), action: 'write', patterns: ['*'] });

    expect(manager.settle('req-1', 'allow')).toBe(true);
    expect(() => manager.settle('req-1', 'deny')).not.toThrow();
    expect(manager.settle('req-1', 'deny')).toBe(false);
  });

  it('settle() on an unknown id returns false and does not throw', () => {
    const manager = new PermissionManager();
    expect(() => manager.settle('missing', 'allow')).not.toThrow();
    expect(manager.settle('missing', 'allow')).toBe(false);
  });

  it('concurrent multi-channel settle: first wins, the rest are no-ops', async () => {
    const manager = new PermissionManager();
    const promise = manager.ask({ id: 'req-1', sessionID: toSessionID('s1'), action: 'write', patterns: ['*'] });

    const results = [manager.settle('req-1', 'allow'), manager.settle('req-1', 'deny')];
    expect(results).toEqual([true, false]);
    await expect(promise).resolves.toBe('allow');
  });

  it('listPending filters by sessionID', () => {
    const manager = new PermissionManager();
    void manager.ask({ id: 'a', sessionID: toSessionID('s1'), action: 'write', patterns: ['*'] });
    void manager.ask({ id: 'b', sessionID: toSessionID('s2'), action: 'write', patterns: ['*'] });

    expect(manager.listPending(toSessionID('s1')).map((r) => r.id)).toEqual(['a']);
  });
});
