import type Database from 'better-sqlite3'

const PAYMENT_HEADER_FIELDS = JSON.stringify(['partner', 'payment', 'settle_account', 'currency', 'remark'])
const PAYMENT_LINE_FIELDS = JSON.stringify(['source_doc', 'amount', 'remark'])
const PAYMENT_REQUIRED_FIELDS = JSON.stringify(['partner', 'settle_account'])

function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e?.message || '').includes('duplicate column name')) throw e
  }
}

/** 收付款明细关联应收应付源日志；空值表示预收/预付或历史自由金额。 */
export function up(db: Database.Database) {
  addColumn(db, 'scm_doc_line', 'arap_source_log_id TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS idx_scm_doc_line_arap_source ON scm_doc_line(account_set_id, arap_source_log_id)')
  db.prepare(`UPDATE scm_doc_type
    SET header_fields=?, line_fields=?, required_fields=?
    WHERE code IN ('PAY','RCV')`).run(
    PAYMENT_HEADER_FIELDS,
    PAYMENT_LINE_FIELDS,
    PAYMENT_REQUIRED_FIELDS,
  )
  console.log('✓ PAY/RCV 明细已支持关联应收应付源单')
}

export function down(db: Database.Database) {
  db.exec('DROP INDEX IF EXISTS idx_scm_doc_line_arap_source')
  // SQLite 兼容性考虑，不删除已新增列；回退字段配置即可。
  db.prepare(`UPDATE scm_doc_type
    SET line_fields=?
    WHERE code IN ('PAY','RCV') AND line_fields=?`).run(
    JSON.stringify(['remark', 'amount']),
    PAYMENT_LINE_FIELDS,
  )
}
