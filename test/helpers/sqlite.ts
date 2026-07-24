import Database from 'better-sqlite3';

/**
 * `:memory:` SQLite 工厂：session-store / long-term-store 等模块的
 * 确定性单测依赖此 helper，禁止在测试中连接真实磁盘数据库文件。
 */
export function createMemoryDb(): Database.Database {
  return new Database(':memory:');
}
