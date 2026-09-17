import type Database from 'better-sqlite3'

/**
 * v124：出纳月结表。
 * 出纳结账独立于总账 period_closing：结账后该月出纳日记账不允许增删改 / 导入 / 生成或删除凭证，
 * 需先反结账；反结账须从最近一个已结月份倒序进行。
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cashier_period_closing (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
      closed_by TEXT,
      closed_by_name TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, year, month)
    );
    CREATE INDEX IF NOT EXISTS idx_cashier_period_closing_set ON cashier_period_closing(account_set_id, year, month);
  `)
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS cashier_period_closing')
}
