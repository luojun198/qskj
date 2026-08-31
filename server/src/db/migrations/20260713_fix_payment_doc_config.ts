import type Database from 'better-sqlite3'

const PAYMENT_HEADER_FIELDS = JSON.stringify(['partner', 'payment', 'settle_account', 'currency', 'remark'])
const PAYMENT_LINE_FIELDS = JSON.stringify(['remark', 'amount'])
const PAYMENT_REQUIRED_FIELDS = JSON.stringify(['partner', 'settle_account'])

/** 修正所有既有账套的收付款单字段配置，不改写历史业务单据。 */
export function up(db: Database.Database) {
  db.prepare(`UPDATE scm_doc_type
    SET header_fields=?, line_fields=?, required_fields=?
    WHERE code IN ('PAY','RCV')`).run(
    PAYMENT_HEADER_FIELDS,
    PAYMENT_LINE_FIELDS,
    PAYMENT_REQUIRED_FIELDS,
  )
  console.log('✓ PAY/RCV 已改为往来单位、结算账户和多行金额明细')
}

export function down(db: Database.Database) {
  db.prepare(`UPDATE scm_doc_type
    SET header_fields=?, line_fields=?, required_fields=?
    WHERE code IN ('PAY','RCV')
      AND header_fields=? AND line_fields=? AND required_fields=?`).run(
    JSON.stringify(['partner', 'payment', 'settle_account']),
    JSON.stringify(['item', 'qty', 'price']),
    JSON.stringify([]),
    PAYMENT_HEADER_FIELDS,
    PAYMENT_LINE_FIELDS,
    PAYMENT_REQUIRED_FIELDS,
  )
}
