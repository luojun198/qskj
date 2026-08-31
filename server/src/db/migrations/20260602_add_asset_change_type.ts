import type Database from 'better-sqlite3'

/**
 * 固定资产增减方式字典表
 *
 * direction: 'increase' = 增加方式（购入、自建、盘盈、捐赠…）
 *            'decrease' = 减少方式（出售、报废、损毁、盘亏、捐赠…）
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixed_asset_change_type (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('increase','decrease')),
      UNIQUE(account_set_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_change_type_set ON fixed_asset_change_type(account_set_id);
  `)
  console.log('✓ 固定资产增减方式字典表已创建: fixed_asset_change_type')
}

export function down(db: Database.Database) {
  db.exec(`DROP TABLE IF EXISTS fixed_asset_change_type`)
  console.log('✓ 固定资产增减方式字典表已删除')
}
