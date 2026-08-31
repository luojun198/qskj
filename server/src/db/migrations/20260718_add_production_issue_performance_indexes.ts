import type Database from 'better-sqlite3'

/** 工单领料生成、状态判定和成本汇总的关联索引。 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scm_doc_plan_action
      ON scm_doc(account_set_id, plan_id, status, doc_type);
    CREATE INDEX IF NOT EXISTS idx_scm_move_doc_lookup
      ON scm_stock_move(account_set_id, doc_type, doc_no, item_code);
  `)
  console.log('✓ 已添加工单领料关联查询索引')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP INDEX IF EXISTS idx_scm_doc_plan_action;
    DROP INDEX IF EXISTS idx_scm_move_doc_lookup;
  `)
}
