import type Database from 'better-sqlite3'

/**
 * 计划用料明细行增加 warehouse_code：支持按行从不同仓库领料；
 * 留空时领料回退计划「原料仓」(yl_warehouse) 作兜底。
 */
export function up(db: Database.Database) {
  try {
    db.prepare('ALTER TABLE scm_production_plan_line ADD COLUMN warehouse_code TEXT').run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
  console.log('✓ scm_production_plan_line 已增加 warehouse_code（行仓库，空走原料仓兜底）')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，保留列即可
}
