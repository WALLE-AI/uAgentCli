import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';

import { openDatabase, migrate } from '../../src/storage/db.js';
import { PRODUCTION_MIGRATIONS } from '../../src/storage/migrations.js';
import {
  AuditSink,
  verifyChain,
  canonicalJSON,
  GENESIS_PREV_HASH,
} from '../../src/permission/audit.js';

function freshDb() {
  const db = openDatabase(':memory:');
  migrate(db, PRODUCTION_MIGRATIONS, { now: () => 1_700_000_000_000 });
  return db;
}

function sampleEvent(i: number) {
  return {
    eventId: `evt-${i}`,
    timestamp: 1_700_000_000_000 + i,
    eventType: 'permission_decision',
    actor: { channel: 'local-cli', userId: null },
    action: { command: `cmd-${i}`, riskLevel: 'soft', approved: true },
    agentAlias: 'build',
  };
}

describe('M0.3 canonicalJSON', () => {
  it('字段顺序无关（改插入序结果一致）', () => {
    const a = canonicalJSON({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalJSON({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });
  it('剔除 undefined 字段', () => {
    expect(canonicalJSON({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('M0.3 审计哈希链', () => {
  it('genesis prev_hash 为 64 个 0', () => {
    const db = freshDb();
    const sink = new AuditSink(db);
    const e = sink.append(sampleEvent(1));
    expect(e.prevHash).toBe(GENESIS_PREV_HASH);
    expect(e.sequence).toBe(1);
    db.close();
  });

  it('链正常时 verifyChain ok', () => {
    const db = freshDb();
    const sink = new AuditSink(db);
    for (let i = 1; i <= 5; i++) sink.append(sampleEvent(i));
    expect(verifyChain(db).ok).toBe(true);
    db.close();
  });

  it('篡改某条历史 → 该条起链断裂', () => {
    const db = freshDb();
    const sink = new AuditSink(db);
    for (let i = 1; i <= 5; i++) sink.append(sampleEvent(i));
    // 篡改第 3 条的 action
    db.prepare('UPDATE audit_log SET action = ? WHERE sequence = 3').run(JSON.stringify({ command: 'HACKED' }));
    const res = verifyChain(db);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(3);
    db.close();
  });

  it('续链：新 sink 从末条继续（跨"重启"）', () => {
    const db = freshDb();
    const sink1 = new AuditSink(db);
    sink1.append(sampleEvent(1));
    sink1.append(sampleEvent(2));
    // 模拟重启：新建 sink 读末条续链
    const sink2 = new AuditSink(db);
    const e3 = sink2.append(sampleEvent(3));
    expect(e3.sequence).toBe(3);
    expect(verifyChain(db).ok).toBe(true);
    db.close();
  });

  it('HMAC 签名：key 非 32 字节抛错', () => {
    const db = freshDb();
    expect(() => new AuditSink(db, { signingKey: Buffer.alloc(16) })).toThrow(/32 bytes/);
    db.close();
  });

  it('HMAC 签名链可用同 key 校验、错 key 失败', () => {
    const db = freshDb();
    const key = randomBytes(32);
    const sink = new AuditSink(db, { signingKey: key });
    for (let i = 1; i <= 3; i++) sink.append(sampleEvent(i));
    expect(verifyChain(db, { signingKey: key }).ok).toBe(true);
    expect(verifyChain(db, { signingKey: randomBytes(32) }).ok).toBe(false);
    db.close();
  });
});
