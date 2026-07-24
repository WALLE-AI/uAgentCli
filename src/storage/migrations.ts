import type { Migration } from './db.js';

/**
 * M0.1 · 生产表 DDL 迁移登记表。
 *
 * 单一事实源：所有生产表在此按版本号声明，`migrate(db, PRODUCTION_MIGRATIONS)`
 * 一次建齐。各后续 Task 通过**追加新版本**扩展，绝不改已发布版本（幂等前提）。
 *
 * 外键统一 `ON DELETE CASCADE`，配合 `openDatabase` 的 `foreign_keys=ON` 生效。
 *
 * 归属对照（《生产化优化迭代计划》）：
 *  - v1 session/message ····· J 节 / T7.9（T7.9 时切 SessionStore 走本表）
 *  - v2 approved_rule ········ K 节 / T8.1
 *  - v3 audit_log ············ M0.3 / K 节 / T8.2
 *  - v4 heartbeat_job/run_log · N 节 / T8.3
 *  - v5 session_context_epoch · J 节 / T11.1（表在此，写入在 T11.1）
 *  - v6 device_token ········· M 节 / T7.4
 *  - session_memory ·········· 由 T8.6 追加（列结构该 Task 定义，此处不预设）
 */
export const PRODUCTION_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    label: 'session_and_message',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session (
          id TEXT PRIMARY KEY,
          parent_session_id TEXT,
          project_id TEXT NOT NULL,
          agent TEXT NOT NULL,
          model TEXT NOT NULL,
          cwd TEXT NOT NULL,
          title TEXT,
          permission TEXT NOT NULL DEFAULT '{"rules":[]}',
          tokens INTEGER NOT NULL DEFAULT 0,
          cost REAL NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_session_project ON session(project_id);
        CREATE INDEX IF NOT EXISTS idx_session_parent ON session(parent_session_id);

        CREATE TABLE IF NOT EXISTS message (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          seq INTEGER NOT NULL,
          tool_call_id TEXT,
          tokens INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id);
        -- keyset 分页索引（T8.8）
        CREATE INDEX IF NOT EXISTS idx_message_session_seq ON message(session_id, seq);
      `);
    },
  },
  {
    version: 2,
    label: 'approved_rule',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS approved_rule (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL,
          action TEXT NOT NULL,
          pattern TEXT NOT NULL,
          decision TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(scope, action, pattern, decision)
        );
        CREATE INDEX IF NOT EXISTS idx_approved_rule_scope ON approved_rule(scope);
      `);
    },
  },
  {
    version: 3,
    label: 'audit_log',
    up: (db) => {
      // 哈希链：sequence 单调、prev_hash 链接、entry_hash 重算校验（M0.3）。
      // payload 各字段以 JSON 文本列存，canonical 序在应用层保证。
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          sequence INTEGER PRIMARY KEY,
          event_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          actor TEXT,
          action TEXT,
          result TEXT,
          security TEXT,
          agent_alias TEXT,
          prev_hash TEXT NOT NULL,
          entry_hash TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    label: 'heartbeat_job_and_run_log',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS heartbeat_job (
          id TEXT PRIMARY KEY,
          cron TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          next_run_at_ms INTEGER,
          last_run_at_ms INTEGER,
          last_run_status TEXT,
          consecutive_errors INTEGER NOT NULL DEFAULT 0,
          job_json TEXT,
          created_at INTEGER NOT NULL
        );
        -- 部分索引：只索引待触发的 job（N 节）
        CREATE INDEX IF NOT EXISTS idx_heartbeat_due
          ON heartbeat_job(next_run_at_ms) WHERE next_run_at_ms IS NOT NULL;

        CREATE TABLE IF NOT EXISTS heartbeat_run_log (
          job_id TEXT NOT NULL REFERENCES heartbeat_job(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          ts INTEGER NOT NULL,
          status TEXT NOT NULL,
          duration_ms INTEGER,
          next_run_at_ms INTEGER,
          error TEXT,
          PRIMARY KEY(job_id, seq)
        );
      `);
    },
  },
  {
    version: 5,
    label: 'session_context_epoch',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_context_epoch (
          session_id TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
          baseline_seq INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 6,
    label: 'device_token',
    up: (db) => {
      // 只存 token_hash（sha256），泄露 DB 也拿不到可用令牌（M 节）。
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_token (
          token_hash TEXT PRIMARY KEY,
          label TEXT,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER,
          expires_at INTEGER,
          revoked_at INTEGER
        );
      `);
    },
  },
];
