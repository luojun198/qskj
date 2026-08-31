import type Database from 'better-sqlite3'

/**
 * 生产成本深化：人工/制费正确并入成品库存成本（跨批 WIP 结转 + 可逆）
 *
 * - scm_production_plan_product：labor_absorbed / overhead_absorbed —— 各成品「已结转进完工成本」的人工/制费累计，
 *   用于每批 true-up（末批按产品吸收剩余、非末批按进度暂提，且封顶=报工累计），反审核时回退。
 * - scm_doc_line：labor_cost / overhead_cost —— 该完工行本次结转的人工/制费金额（成品单价含此部分），
 *   供反审核精确回退与生成凭证时拆分「生产成本(料) / 应付职工薪酬(人工) / 制造费用(制费)」。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run() }
  catch (e: any) { if (!String(e.message).includes('duplicate column name')) throw e }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_production_plan_product', 'labor_absorbed REAL NOT NULL DEFAULT 0')
  addColumn(db, 'scm_production_plan_product', 'overhead_absorbed REAL NOT NULL DEFAULT 0')
  addColumn(db, 'scm_doc_line', 'labor_cost REAL NOT NULL DEFAULT 0')
  addColumn(db, 'scm_doc_line', 'overhead_cost REAL NOT NULL DEFAULT 0')
  console.log('✓ scm_production_plan_product 加 labor/overhead_absorbed；scm_doc_line 加 labor/overhead_cost')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，保留列（无害）
}
