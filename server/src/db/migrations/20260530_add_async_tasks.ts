import type Database from 'better-sqlite3'

/** 异步任务持久化，避免服务重启后任务状态丢失导致轮询 404 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS async_tasks (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_async_tasks_updated_at ON async_tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_async_tasks_account_set ON async_tasks(account_set_id);
  `)
  console.log('✓ async_tasks 表已创建')
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS async_tasks')
  console.log('✓ async_tasks 表已删除')
}
