import type Database from 'better-sqlite3'

/**
 * Phase 1：供应链单据类型字段配置中心
 *
 * scm_doc_type 增加 header_fields / line_fields / required_fields 三个 JSON 列，
 * 声明每种单据类型在表单上显示哪些表头字段块、哪些明细列、哪些必填。
 * 默认配置由 server/src/routes/scmDoc.ts 的 seedDocTypes() 按 category 填充。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_doc_type', "header_fields TEXT")    // JSON 数组：显示的表头字段
  addColumn(db, 'scm_doc_type', "line_fields TEXT")      // JSON 数组：显示的明细列
  addColumn(db, 'scm_doc_type', "required_fields TEXT")  // JSON 数组：必填项
  console.log('✓ scm_doc_type 已增加字段配置列: header_fields / line_fields / required_fields')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，保留列即可（无害）
}
