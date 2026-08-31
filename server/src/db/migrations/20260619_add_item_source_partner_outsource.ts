import type Database from 'better-sqlite3'

/**
 * 物料来源驱动下推：
 * - scm_item.source_type：物料来源 purchase 采购 / outsource 委外 / self 自制（采购、委外配 supplier_code）。
 * - scm_partner.is_outsource：供应商「委外厂」标识（供应商可同时是委外厂）。
 * - scm_doc_line.source_type：缺料单行快照来源（可逐行改，决定下推目标）。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_item', "source_type TEXT DEFAULT 'purchase'") // purchase/outsource/self
  addColumn(db, 'scm_partner', 'is_outsource INTEGER DEFAULT 0')   // 委外厂标识
  addColumn(db, 'scm_doc_line', 'source_type TEXT')                // 缺料单行来源快照
  console.log('✓ scm_item.source_type / scm_partner.is_outsource / scm_doc_line.source_type 已加')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN
}
