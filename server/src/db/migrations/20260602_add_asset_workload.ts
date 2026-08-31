import type Database from 'better-sqlite3'

/**
 * 固定资产工作量表
 *
 * 用于工作量法折旧：每月录入各资产的实际工作量，
 * 折旧预览时自动读取对应期间的工作量计算月折旧额。
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixed_asset_workload (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      asset_no TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      workload REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, asset_no, year, month)
    );
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_workload_period ON fixed_asset_workload(account_set_id, year, month);
  `)
  console.log('✓ 固定资产工作量表已创建: fixed_asset_workload')
}

export function down(db: Database.Database) {
  db.exec(`DROP TABLE IF EXISTS fixed_asset_workload`)
  console.log('✓ 固定资产工作量表已删除')
}
