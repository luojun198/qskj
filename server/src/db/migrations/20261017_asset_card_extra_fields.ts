import type Database from 'better-sqlite3'

/**
 * v169：固定资产卡片补充字段（第七份反馈：资产卡片列表参照润衡「能多不能少」）
 *
 * - spec 规格型号、ref_no 参考编号、manufacturer 制造厂家、manufacture_date 制造日期（YYYY-MM-DD）
 * - 全部可空，存量卡片不受影响
 */
const COLUMNS = ['spec TEXT', 'ref_no TEXT', 'manufacturer TEXT', 'manufacture_date TEXT']

export function up(db: Database.Database) {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixed_asset'").get()
  if (!has) return
  const cols = new Set((db.prepare('PRAGMA table_info(fixed_asset)').all() as Array<{ name: string }>).map(c => c.name))
  for (const ddl of COLUMNS) {
    if (!cols.has(ddl.split(' ')[0])) db.exec(`ALTER TABLE fixed_asset ADD COLUMN ${ddl}`)
  }
  console.log('✓ 固定资产卡片：规格型号 / 参考编号 / 制造厂家 / 制造日期 已就绪')
}

export function down(_db: Database.Database) {
  // SQLite 删列需重建表；新增列可空、不影响旧代码，回滚时保留
}
