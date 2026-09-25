import type Database from 'better-sqlite3'

/**
 * FIX-325：出纳日记账「币种与科目不一致」提示计数（FIX-309）按 currency <> ? 过滤，原有索引只到 (账套, 科目, 日期)，
 * 需扫描该科目全部流水（25 万行时 1.1s，每次打开日记账都要付）。加 (账套, 科目, 币种) 索引，查询改写为
 * currency < ? OR currency > ? 两段范围扫描，无不一致行时近乎零成本。
 */
export function up(db: Database.Database): void {
  const has = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cashier_journal'").get()
  if (!has) return
  db.exec('CREATE INDEX IF NOT EXISTS idx_cashier_journal_acct_currency ON cashier_journal(account_set_id, account_code, currency)')
}

export function down(db: Database.Database): void {
  db.exec('DROP INDEX IF EXISTS idx_cashier_journal_acct_currency')
}
