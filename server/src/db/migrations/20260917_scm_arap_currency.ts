import type Database from 'better-sqlite3'

/**
 * 2026-09-17 进销存评审 P2-14：往来台账多币种双轨。
 *
 * scm_ar_ap_log 原来只有一个 amount，外币单据按原币金额直接记成本位币。
 * 新增：
 *  - currency       单据币别（本位币记本位币编码）
 *  - exchange_rate  记账汇率（本位币 = 原币 × 汇率）
 *  - amount_fc      原币金额；amount 从此明确为本位币金额
 *  - verified_fc    已核销原币金额；verified_amount 为按比例折算的本位币已核销额
 * 存量回填：全部视为本位币（currency = 账套本位币、汇率 1、amount_fc = amount、verified_fc = verified_amount）。
 */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === column)
}
function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

export function up(db: Database.Database): void {
  if (!hasTable(db, 'scm_ar_ap_log')) return
  if (!hasColumn(db, 'scm_ar_ap_log', 'currency')) db.exec('ALTER TABLE scm_ar_ap_log ADD COLUMN currency TEXT')
  if (!hasColumn(db, 'scm_ar_ap_log', 'exchange_rate')) db.exec('ALTER TABLE scm_ar_ap_log ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1')
  if (!hasColumn(db, 'scm_ar_ap_log', 'amount_fc')) db.exec('ALTER TABLE scm_ar_ap_log ADD COLUMN amount_fc REAL')
  if (!hasColumn(db, 'scm_ar_ap_log', 'verified_fc')) db.exec('ALTER TABLE scm_ar_ap_log ADD COLUMN verified_fc REAL NOT NULL DEFAULT 0')

  // 回填：按账套本位币（currencies.is_base → system_params.base_currency → RMB）
  const sets = (db.prepare('SELECT DISTINCT account_set_id FROM scm_ar_ap_log').all() as Array<{ account_set_id: string }>)
  let filled = 0
  for (const { account_set_id } of sets) {
    let base = ''
    if (hasTable(db, 'currencies')) {
      const row = db.prepare('SELECT code FROM currencies WHERE account_set_id=? AND is_base=1 LIMIT 1').get(account_set_id) as any
      base = String(row?.code || '')
    }
    if (!base) {
      const row = db.prepare("SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='base_currency' LIMIT 1").get(account_set_id) as any
      base = String(row?.param_value || '').trim().toUpperCase()
    }
    if (!base || base === 'CNY') base = 'RMB'
    filled += db.prepare(`UPDATE scm_ar_ap_log SET currency=?, exchange_rate=1, amount_fc=amount, verified_fc=COALESCE(verified_amount,0)
      WHERE account_set_id=? AND (currency IS NULL OR currency='' OR amount_fc IS NULL)`).run(base, account_set_id).changes
  }
  console.log(`✓ 往来台账多币种列已加，回填 ${filled} 行为本位币`)
}

export function down(_db: Database.Database): void {
  console.log('⚠ SQLite 不支持删列，scm_ar_ap_log 的 currency/exchange_rate/amount_fc/verified_fc 保留（无害）')
}
