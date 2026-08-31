import type Database from 'better-sqlite3'

/**
 * v48：fixed_asset_depr 新增 voucher_id 字段
 * 关联「折旧期间 → 生成的折旧凭证」（同一期间各资产行写同一 voucher_id），
 * 支持：按期间补生成凭证（防重复）、反折旧时连带删除该期凭证、历史页展示凭证状态。
 */
export function up(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(fixed_asset_depr)').all() as any[]).map((c: any) => c.name)
  if (!cols.includes('voucher_id')) {
    db.exec(`ALTER TABLE fixed_asset_depr ADD COLUMN voucher_id TEXT;`)
    console.log('✓ fixed_asset_depr.voucher_id 字段添加完成')
  }
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，跳过
}
