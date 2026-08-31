import type Database from 'better-sqlite3'

/**
 * scm_ar_ap_log 按 doc_type + doc_no 反查的复合索引
 *
 * 背景：销售订单关联大表（querySalesOrderRelations）的 arap_payment 关联步骤会按
 * `al.account_set_id + al.doc_type + al.doc_no` 与 scm_doc 反向 JOIN，原表只有
 * `(account_set_id, partner_code, doc_date)` 与 `(account_set_id, partner_code, due_date)`，
 * 没有 doc_type/doc_no 复合索引，JOIN 时会全表扫描。
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scm_arap_doc
      ON scm_ar_ap_log(account_set_id, doc_type, doc_no);
  `)
  console.log('✓ 已添加 scm_ar_ap_log 单据类型+单号反查索引')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP INDEX IF EXISTS idx_scm_arap_doc;
  `)
}
