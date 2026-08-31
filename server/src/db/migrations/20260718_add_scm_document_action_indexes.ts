import type Database from 'better-sqlite3'

/** 单据新建、下推、审核与反审核共用查询的索引。 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scm_stock_lookup
      ON scm_stock(account_set_id, warehouse_code, item_code);
    CREATE INDEX IF NOT EXISTS idx_scm_doc_line_source
      ON scm_doc_line(source_line_id, doc_id);
    CREATE INDEX IF NOT EXISTS idx_scm_doc_source
      ON scm_doc(account_set_id, source_doc_id, doc_type, doc_no);
    CREATE INDEX IF NOT EXISTS idx_scm_plan_source
      ON scm_production_plan(account_set_id, source_doc_id);
    CREATE INDEX IF NOT EXISTS idx_scm_batch_move_doc
      ON scm_batch_move(account_set_id, doc_id);
    CREATE INDEX IF NOT EXISTS idx_scm_serial_move_doc
      ON scm_serial_move(account_set_id, doc_id);
  `)
  console.log('✓ 已添加供应链单据动作查询索引')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP INDEX IF EXISTS idx_scm_stock_lookup;
    DROP INDEX IF EXISTS idx_scm_doc_line_source;
    DROP INDEX IF EXISTS idx_scm_doc_source;
    DROP INDEX IF EXISTS idx_scm_plan_source;
    DROP INDEX IF EXISTS idx_scm_batch_move_doc;
    DROP INDEX IF EXISTS idx_scm_serial_move_doc;
  `)
}
