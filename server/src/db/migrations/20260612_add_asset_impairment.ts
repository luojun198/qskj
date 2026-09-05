import type Database from 'better-sqlite3'

/**
 * v111：fixed_asset 新增 impairment_amount（累计减值准备）
 *
 * fixed_asset_category.impairment_account_code 早已存在、字典界面也能配置，
 * 但代码中从未被引用——减值功能完全没有落地。本列为减值业务提供账面载体。
 *
 * 净值口径随之调整为：net_value = original_value - accum_depr - impairment_amount
 * （既有数据 impairment_amount 默认 0，净值不变，无需回算。）
 */
export function up(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(fixed_asset)').all() as any[]).map((c: any) => c.name)
  if (!cols.includes('impairment_amount')) {
    db.exec(`ALTER TABLE fixed_asset ADD COLUMN impairment_amount REAL DEFAULT 0;`)
    db.prepare('UPDATE fixed_asset SET impairment_amount = 0 WHERE impairment_amount IS NULL').run()
    console.log('✓ fixed_asset.impairment_amount 字段添加完成')
  }
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，跳过
}
