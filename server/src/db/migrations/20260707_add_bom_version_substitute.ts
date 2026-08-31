import type Database from 'better-sqlite3'

/**
 * 生产模块增强 Phase 4：BOM 版本/有效期 + 行类型(主件/副产品/联产品) + 替代料
 *
 * - scm_bom：version(版本)、effective_date/expire_date(有效期)、is_default(默认版本)
 * - scm_bom_line：line_type(component 主件 / by_product 副产品 / co_product 联产品)、
 *   sub_group(替代料组号，同组为可替代)、sub_priority(替代优先级，0=主料)
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run() }
  catch (e: any) { if (!String(e.message).includes('duplicate column name')) throw e }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_bom', "version TEXT DEFAULT '1.0'")
  addColumn(db, 'scm_bom', 'effective_date TEXT')
  addColumn(db, 'scm_bom', 'expire_date TEXT')
  addColumn(db, 'scm_bom', 'is_default INTEGER NOT NULL DEFAULT 1')
  addColumn(db, 'scm_bom_line', "line_type TEXT NOT NULL DEFAULT 'component'")
  addColumn(db, 'scm_bom_line', 'sub_group TEXT')
  addColumn(db, 'scm_bom_line', 'sub_priority INTEGER NOT NULL DEFAULT 0')
  console.log('✓ scm_bom 加版本/有效期/默认；scm_bom_line 加行类型/替代料组')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，保留列（无害）
}
