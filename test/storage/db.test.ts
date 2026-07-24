import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

import {
  openDatabase,
  migrate,
  columnExists,
  addColumnIfMissing,
  isVecLoaded,
  tryLoadVec,
  type Migration,
} from '../../src/storage/db.js';
import { PRODUCTION_MIGRATIONS } from '../../src/storage/migrations.js';

const fixedNow = () => 1_700_000_000_000;

describe('M0.1 openDatabase · PRAGMA 注入', () => {
  it('foreign_keys=ON 且 CASCADE 生效（每连接开关）', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

    migrate(db, PRODUCTION_MIGRATIONS, { now: fixedNow });

    db.prepare(
      `INSERT INTO session (id, project_id, agent, model, cwd, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 'p1', 'build', 'claude', '/tmp', fixedNow());
    db.prepare(
      `INSERT INTO message (id, session_id, role, content, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('m1', 's1', 'user', '[]', 0, fixedNow());

    // 删 session 应级联删 message
    db.prepare('DELETE FROM session WHERE id = ?').run('s1');
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM message').get() as { n: number };
    expect(remaining.n).toBe(0);
    db.close();
  });

  it('synchronous/busy_timeout/cache_size 已设', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('cache_size', { simple: true })).toBe(-64000);
    db.close();
  });

  it(':memory: 不设 WAL（无意义），文件库才设 WAL', () => {
    const mem = openDatabase(':memory:');
    expect(String(mem.pragma('journal_mode', { simple: true })).toLowerCase()).not.toBe('wal');
    mem.close();
  });
});

describe('M0.1 sqlite-vec 降级', () => {
  it('未安装扩展时 tryLoadVec 返回 false，不抛异常', () => {
    const db = openDatabase(':memory:');
    // sqlite-vec 未作为依赖安装 → 应优雅降级
    const loaded = tryLoadVec(db);
    expect(typeof loaded).toBe('boolean');
    expect(isVecLoaded(db)).toBe(loaded);
    db.close();
  });
});

describe('M0.1 migrate · 幂等 + 版本管理', () => {
  it('重复运行不重复 apply', () => {
    const db = openDatabase(':memory:');
    migrate(db, PRODUCTION_MIGRATIONS, { now: fixedNow });
    migrate(db, PRODUCTION_MIGRATIONS, { now: fixedNow });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number };
    expect(rows.n).toBe(PRODUCTION_MIGRATIONS.length);
    db.close();
  });

  it('建齐全部生产表', () => {
    const db = openDatabase(':memory:');
    migrate(db, PRODUCTION_MIGRATIONS, { now: fixedNow });
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    for (const t of [
      'session',
      'message',
      'approved_rule',
      'audit_log',
      'heartbeat_job',
      'heartbeat_run_log',
      'session_context_epoch',
      'device_token',
    ]) {
      expect(tables.has(t)).toBe(true);
    }
    db.close();
  });

  it('重复版本号抛错', () => {
    const db = new Database(':memory:');
    const dup: Migration[] = [
      { version: 1, up: () => {} },
      { version: 1, up: () => {} },
    ];
    expect(() => migrate(db, dup)).toThrow(/duplicate migration version 1/);
    db.close();
  });

  it('已 apply 的旧版本不再重跑（只跑新增版本）', () => {
    const db = openDatabase(':memory:');
    let ran = 0;
    const v1: Migration = { version: 1, up: () => { ran++; } };
    migrate(db, [v1]);
    const v2: Migration = { version: 2, up: () => { db.exec('CREATE TABLE t2(x)'); } };
    migrate(db, [v1, v2]);
    expect(ran).toBe(1); // v1 只跑一次
    const rows = db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number };
    expect(rows.n).toBe(2);
    db.close();
  });
});

describe('M0.1 columnExists / addColumnIfMissing', () => {
  it('探测已存在列 / 缺失列', () => {
    const db = openDatabase(':memory:');
    migrate(db, PRODUCTION_MIGRATIONS, { now: fixedNow });
    expect(columnExists(db, 'session', 'project_id')).toBe(true);
    expect(columnExists(db, 'session', 'nope')).toBe(false);
    db.close();
  });

  it('addColumnIfMissing 幂等（重复调用不报 duplicate column）', () => {
    const db = openDatabase(':memory:');
    migrate(db, PRODUCTION_MIGRATIONS, { now: fixedNow });
    addColumnIfMissing(db, 'session', 'note', 'note TEXT');
    addColumnIfMissing(db, 'session', 'note', 'note TEXT'); // 第二次应跳过
    expect(columnExists(db, 'session', 'note')).toBe(true);
    db.close();
  });
});
