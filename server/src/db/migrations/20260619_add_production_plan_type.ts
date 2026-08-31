import type Database from 'better-sqlite3'

/**
 * 生产计划区分自制/委外：销售订单缺口下推时，复用 scm_production_plan 表，
 * 用 plan_type（self 自制 / outsource 委外）区分，委外可记供应商 supplier_code。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_production_plan', "plan_type TEXT DEFAULT 'self'") // self=自制 outsource=委外
  addColumn(db, 'scm_production_plan', "supplier_code TEXT")            // 委外供应商（可空）
  console.log('✓ scm_production_plan 增加 plan_type/supplier_code')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，新增列保留
}
