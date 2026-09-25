import type Database from 'better-sqlite3'

/**
 * 固定资产状态 04 由「已报废」更名为「已处置」。
 * 处置（出售 / 报废 / 盘亏 / 捐赠等所有减少方式）统一置为 04，叫「已报废」对出售的资产不准确。
 * 只改仍是默认名称的账套，用户自行改过名称的不动。
 */
function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

export function up(db: Database.Database): void {
  if (!hasTable(db, 'fixed_asset_status')) return
  db.prepare("UPDATE fixed_asset_status SET name='已处置' WHERE code='04' AND name='已报废'").run()
}

export function down(db: Database.Database): void {
  if (!hasTable(db, 'fixed_asset_status')) return
  db.prepare("UPDATE fixed_asset_status SET name='已报废' WHERE code='04' AND name='已处置'").run()
}
