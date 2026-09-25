import type Database from 'better-sqlite3'

/**
 * 2026-09-19 十万级压测（FIX-250）余额表索引：
 *  - vouchers(account_set_id, status, voucher_date)：余额表 entry_agg CTE 按「账套 + 状态 + 日期区间」扫凭证，
 *    现有 idx_vouchers_date 只有 voucher_date 单列（后来的复合定义因同名 IF NOT EXISTS 未生效），
 *    idx_vouchers_period_status 走 year/period 对日期区间无用。
 *  - voucher_entries(voucher_id, account_id, direction, amount)：CTE 从凭证侧 JOIN 分录时的覆盖索引，
 *    金额列直接从索引取，不回表。数量 / 外币列不入索引（占比小，回表可接受）。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vouchers_set_status_date ON vouchers(account_set_id, status, voucher_date);
    CREATE INDEX IF NOT EXISTS idx_voucher_entries_voucher_account ON voucher_entries(voucher_id, account_id, direction, amount);
  `)
  db.exec('ANALYZE')
  console.log('✓ 余额表索引已建，已刷新统计信息')
}

export function down(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_vouchers_set_status_date;
    DROP INDEX IF EXISTS idx_voucher_entries_voucher_account;
  `)
}
