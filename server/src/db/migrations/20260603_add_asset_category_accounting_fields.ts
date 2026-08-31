import type Database from 'better-sqlite3'

/**
 * 为固定资产类别字典添加科目勾稽关系字段
 * 
 * 增加：
 * 1. depr_account_code: 累计折旧科目
 * 2. impairment_account_code: 减值准备科目
 * 3. clearing_account_code: 固定资产清理科目
 */
export function up(db: Database.Database) {
  db.exec(`
    ALTER TABLE fixed_asset_category ADD COLUMN depr_account_code TEXT;
    ALTER TABLE fixed_asset_category ADD COLUMN impairment_account_code TEXT;
    ALTER TABLE fixed_asset_category ADD COLUMN clearing_account_code TEXT;
  `)
  console.log('✓ fixed_asset_category 表已增加科目勾稽字段')
}

export function down(db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，回滚时通常需要重建表。
  // 考虑到这是新增字段且不破坏原数据，回滚逻辑可以留空或在开发阶段手动处理。
  console.log('⚠ 回滚 fixed_asset_category 字段增加需要重建表，此处略过')
}
