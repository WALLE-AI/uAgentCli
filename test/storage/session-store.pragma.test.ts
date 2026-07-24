import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../src/storage/db.js';
import { SessionStore } from '../../src/storage/session-store.js';

describe('T7.9 SessionStore over openDatabase', () => {
  it('foreign_keys=ON + message.session_id CASCADE：删 session 级联删 message', () => {
    const db = openDatabase(':memory:');
    const store = new SessionStore(db);
    const s = store.createSession({ projectId: 'p', agent: 'build', model: 'm', cwd: '/x' });
    store.appendMessage({ sessionId: s.id, role: 'user', content: [{ type: 'text', text: 'hi' }], seq: 0 });
    expect(store.listMessages(s.id).length).toBe(1);

    db.prepare('DELETE FROM session WHERE id = ?').run(s.id);
    expect(store.listMessages(s.id).length).toBe(0); // CASCADE 生效
    db.close();
  });

  it('PRAGMA busy_timeout 已注入（并发写不立即 SQLITE_BUSY）', () => {
    const db = openDatabase(':memory:');
    new SessionStore(db);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    db.close();
  });

  it('keyset 分页索引 idx_message_session_seq 存在', () => {
    const db = openDatabase(':memory:');
    new SessionStore(db);
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_message_session_seq'")
      .get();
    expect(idx).toBeTruthy();
    db.close();
  });
});
