import type Database from 'better-sqlite3'

/**
 * 生产闭环（阶段1）：为 scm_doc 增加 plan_id，关联生产计划/工单。
 * 领料(PL)/补料(PB)/退料(PJ)/完工入库(PF) 等单据通过 plan_id 归集到工单，
 * 用于在制(WIP)成本归集与完工成本结转。其它单据为 null。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_doc', 'plan_id TEXT')
  console.log('✓ scm_doc.plan_id 已添加（生产闭环工单关联）')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN；保留列
}
