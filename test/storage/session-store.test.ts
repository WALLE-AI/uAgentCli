import { describe, expect, it } from 'vitest';
import { createMemoryDb } from '../helpers/sqlite.js';
import { SessionStore } from '../../src/storage/session-store.js';

function makeStore(): SessionStore {
  return new SessionStore(createMemoryDb());
}

describe('SessionStore', () => {
  it('creates and retrieves a session', () => {
    const store = makeStore();
    const created = store.createSession({
      projectId: 'proj-1',
      agent: 'build',
      model: 'claude-sonnet-5',
      cwd: '/home/user/project',
    });
    const fetched = store.getSession(created.id);
    expect(fetched).toEqual(created);
  });

  it('returns undefined for an unknown session id', () => {
    const store = makeStore();
    expect(store.getSession('missing')).toBeUndefined();
  });

  it('appends messages and lists them ordered by seq (CRUD)', () => {
    const store = makeStore();
    const session = store.createSession({ projectId: 'p', agent: 'build', model: 'm', cwd: '/x' });

    store.appendMessage({ sessionId: session.id, role: 'user', content: [{ type: 'text', text: 'hi' }], seq: 2 });
    store.appendMessage({ sessionId: session.id, role: 'assistant', content: [{ type: 'text', text: 'hello' }], seq: 1 });

    const messages = store.listMessages(session.id);
    expect(messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(messages[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('indexes sessions by project_id', () => {
    const store = makeStore();
    store.createSession({ projectId: 'proj-a', agent: 'build', model: 'm', cwd: '/a' });
    store.createSession({ projectId: 'proj-a', agent: 'build', model: 'm', cwd: '/a' });
    store.createSession({ projectId: 'proj-b', agent: 'build', model: 'm', cwd: '/b' });

    expect(store.listSessionsByProject('proj-a')).toHaveLength(2);
    expect(store.listSessionsByProject('proj-b')).toHaveLength(1);
    expect(store.listSessionsByProject('proj-c')).toHaveLength(0);
  });

  it('records child sessions via parent_session_id', () => {
    const store = makeStore();
    const parent = store.createSession({ projectId: 'p', agent: 'build', model: 'm', cwd: '/x' });
    const child = store.createSession({
      projectId: 'p',
      agent: 'explore',
      model: 'm',
      cwd: '/x',
      parentSessionId: parent.id,
    });

    const children = store.listChildSessions(parent.id);
    expect(children.map((c) => c.id)).toEqual([child.id]);
    expect(store.getSession(child.id)?.parentSessionId).toBe(parent.id);
  });

  it('active-filtered resume only returns non-archived sessions and active messages', () => {
    const store = makeStore();
    const active = store.createSession({ projectId: 'p', agent: 'build', model: 'm', cwd: '/x' });
    const archived = store.createSession({ projectId: 'p', agent: 'build', model: 'm', cwd: '/x' });
    store.archiveSession(archived.id);

    const activeOnly = store.listSessionsByProject('p', { activeOnly: true });
    expect(activeOnly.map((s) => s.id)).toEqual([active.id]);

    store.appendMessage({ sessionId: active.id, role: 'user', content: [{ type: 'text', text: 'a' }], seq: 1 });
    store.appendMessage({ sessionId: active.id, role: 'user', content: [{ type: 'text', text: 'b' }], seq: 2 });
    store.deactivateMessages(active.id, [1]);

    const activeMessages = store.listMessages(active.id, { activeOnly: true });
    expect(activeMessages.map((m) => m.seq)).toEqual([2]);
  });

  it('permission column round-trips as a Ruleset', () => {
    const store = makeStore();
    const permission = { rules: [{ action: 'read' as const, pattern: '*', decision: 'allow' as const }] };
    const session = store.createSession({ projectId: 'p', agent: 'build', model: 'm', cwd: '/x', permission });
    expect(store.getSession(session.id)?.permission).toEqual(permission);
  });
});
