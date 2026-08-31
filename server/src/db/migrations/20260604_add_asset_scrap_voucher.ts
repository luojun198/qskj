import type Database from 'better-sqlite3'

/**
 * v49：fixed_asset 新增处置关联字段
 * - scrap_voucher_id：处置时生成的清理凭证 id，撤销处置时据此删除凭证
 * - pre_scrap_status：处置前的 status_code，撤销处置时据此还原资产状态
 * 支持「撤销处置」与「处置」对称闭环。
 */
export function up(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(fixed_asset)').all() as any[]).map((c: any) => c.name)
  if (!cols.includes('scrap_voucher_id')) {
    db.exec(`ALTER TABLE fixed_asset ADD COLUMN scrap_voucher_id TEXT;`)
    console.log('✓ fixed_asset.scrap_voucher_id 字段添加完成')
  }
  if (!cols.includes('pre_scrap_status')) {
    db.exec(`ALTER TABLE fixed_asset ADD COLUMN pre_scrap_status TEXT;`)
    console.log('✓ fixed_asset.pre_scrap_status 字段添加完成')
  }
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，跳过
}
