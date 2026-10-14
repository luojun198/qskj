import type Database from 'better-sqlite3'

/**
 * v160：scm_ar_ap_log(cashier_journal_id) 索引
 *
 * 收付款制证方式（payment_voucher_mode）要求出纳侧逐行识别「来源于收付款单」的流水，
 * 日记账列表、生成凭证、业务凭证中心计数都会跑 EXISTS 子查询，没有索引会全表扫描。
 */
export function up(db: Database.Database) {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_ar_ap_log'").get()
  if (!has) return
  db.exec('CREATE INDEX IF NOT EXISTS idx_scm_arap_journal ON scm_ar_ap_log(cashier_journal_id)')
  console.log('✓ scm_ar_ap_log.cashier_journal_id 索引已创建')
}

export function down(db: Database.Database) {
  db.exec('DROP INDEX IF EXISTS idx_scm_arap_journal')
}
