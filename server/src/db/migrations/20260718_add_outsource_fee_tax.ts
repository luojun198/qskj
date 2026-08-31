import type Database from 'better-sqlite3'

/** 委外计划成品加工费税价 + 库存明细账查询索引。 */
export function up(db: Database.Database) {
  const columns = new Set((db.prepare('PRAGMA table_info(scm_production_plan_product)').all() as any[]).map(row => row.name))
  if (!columns.has('process_fee')) db.exec('ALTER TABLE scm_production_plan_product ADD COLUMN process_fee REAL NOT NULL DEFAULT 0')
  if (!columns.has('process_tax_rate')) db.exec('ALTER TABLE scm_production_plan_product ADD COLUMN process_tax_rate REAL NOT NULL DEFAULT 0')
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scm_move_ledger
      ON scm_stock_move(account_set_id, move_date, item_code, warehouse_code);
    CREATE INDEX IF NOT EXISTS idx_scm_doc_plan_type_status
      ON scm_doc(account_set_id, plan_id, doc_type, status);
  `)
  console.log('✓ 已添加委外加工费税价字段与库存明细账索引')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP INDEX IF EXISTS idx_scm_move_ledger;
    DROP INDEX IF EXISTS idx_scm_doc_plan_type_status;
  `)
  // SQLite 兼容旧部署，不删除新增列。
}
