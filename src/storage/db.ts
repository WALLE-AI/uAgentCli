import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

/**
 * M0.1 · 数据库基础设施收口。
 *
 * 所有持久化模块（session-store / permission / heartbeat / memory / audit）
 * 共用这里的 `openDatabase()`——单一入口注入 PRAGMA、加载 sqlite-vec 扩展、
 * 运行迁移。理由见《生产化优化迭代计划》§三 M0.1：不前置就会每个持久化
 * Task 各写一遍 PRAGMA，`foreign_keys` 每连接开关漏设 → CASCADE 静默失效。
 *
 * 部署形态：本地客户端、单机单进程（见记忆 deployment-form-local-client）。
 * 因此不做 `BEGIN IMMEDIATE` 抢写锁 / 进程间 Semaphore 串行；WAL 仅为崩溃安全。
 */

export interface OpenDatabaseOptions {
  /** 只读连接。 */
  readonly?: boolean;
  /** 尝试加载 sqlite-vec 向量扩展。失败不抛，降级由调用方按 `isVecLoaded` 处理。 */
  loadVec?: boolean;
}

const vecLoaded = new WeakSet<Database.Database>();

function isMemoryPath(filename: string): boolean {
  return filename === ':memory:' || filename.startsWith('file::memory:') || filename.includes(':memory:');
}

/**
 * 全套生产 PRAGMA。`foreign_keys` 是**每连接**开关，每个 `new Database` 都要重设，
 * 否则 `ON DELETE CASCADE` 静默失效——这是 M0.1 存在的首要理由。
 */
function applyPragmas(db: Database.Database, filename: string): void {
  // WAL 在 :memory: 上无意义（且部分平台报错），跳过。
  if (!isMemoryPath(filename)) {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -64000'); // 64MB page cache
  db.pragma('foreign_keys = ON');
}

/**
 * 尝试加载 sqlite-vec（`vec0` 虚拟表）。sqlite-vec 是原生扩展，需按
 * Linux/macOS/Windows 三平台打包对应二进制（§零本地客户端装 3 平台）。
 * 未安装 / 加载失败时**不抛异常**，返回 false，向量检索降级到词袋/LLM 挑选。
 */
export function tryLoadVec(db: Database.Database): boolean {
  try {
    const require = createRequire(import.meta.url);
    // sqlite-vec 官方 npm 暴露 load(db)；未安装则 require 抛错被捕获。
    const sqliteVec = require('sqlite-vec') as { load: (db: Database.Database) => void };
    sqliteVec.load(db);
    vecLoaded.add(db);
    return true;
  } catch {
    return false;
  }
}

/** 该连接上 sqlite-vec 是否已成功加载。 */
export function isVecLoaded(db: Database.Database): boolean {
  return vecLoaded.has(db);
}

/**
 * 打开一个已注入全套 PRAGMA 的数据库连接。这是唯一的建连入口。
 */
export function openDatabase(filename: string, options: OpenDatabaseOptions = {}): Database.Database {
  const db = new Database(filename, { readonly: options.readonly ?? false });
  applyPragmas(db, filename);
  if (options.loadVec) {
    tryLoadVec(db);
  }
  return db;
}

// ─────────────────────────────────────────────────────────────────────────────
// 迁移框架（goose 版本号范式：schema_version(version PK, applied_at)）
// ─────────────────────────────────────────────────────────────────────────────

export interface Migration {
  /** 单调递增的版本号；重复版本号视为错误。 */
  readonly version: number;
  /** 人类可读标签，仅用于调试。 */
  readonly label?: string;
  /** 施加变更。同一事务内与 schema_version 写入原子提交。 */
  readonly up: (db: Database.Database) => void;
}

export interface MigrateOptions {
  /** 注入时钟（测试用），默认 `Date.now`。 */
  now?: () => number;
}

/**
 * 幂等地运行迁移：已 apply 的版本跳过，其余按版本升序在独立事务里 apply。
 * 单进程形态无需进程间锁；同进程内 better-sqlite3 调用天然串行。
 */
export function migrate(db: Database.Database, migrations: readonly Migration[], options: MigrateOptions = {}): void {
  const now = options.now ?? Date.now;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new Error(`migrate: duplicate migration version ${m.version}`);
    }
    seen.add(m.version);
  }

  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const isApplied = db.prepare('SELECT 1 FROM schema_version WHERE version = ?');
  const markApplied = db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)');

  for (const m of sorted) {
    if (isApplied.get(m.version)) {
      continue;
    }
    const tx = db.transaction(() => {
      m.up(db);
      markApplied.run(m.version, now());
    });
    tx();
  }
}

/**
 * 探测列是否存在。SQLite `ALTER TABLE ADD COLUMN` 无 `IF NOT EXISTS`，
 * 加列前必须先探测（goose 范式）。
 */
export function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').all(table, column);
  return rows.length > 0;
}

/**
 * 幂等加列。`ddl` 是 `ADD COLUMN` 之后的部分，如 `"description TEXT"`。
 * ⚠ SQLite 要求 ADD COLUMN 的非空默认值必须是常量（不能 CURRENT_TIMESTAMP）。
 */
export function addColumnIfMissing(db: Database.Database, table: string, column: string, ddl: string): void {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
