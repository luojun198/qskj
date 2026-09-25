import type Database from 'better-sqlite3'

/**
 * FIX-326：出纳日记账 (账套, 科目, 币种, 日期, 序号, 创建时间, 借, 贷, 本位币借, 本位币贷, 已对账) 覆盖索引，替代迁移 151 的
 * (账套, 科目, 币种) 前缀索引。出纳余额 / 区间合计 / 未对汇总原先走 (账套, 科目, 日期) 索引再逐行回表
 * （25 万流水时 ~1.2s，对账工作台一次请求要算好几遍），覆盖索引下只读索引 ~40ms；
 * 日记账合计（含本位币合计）与 FIX-325 的币种不一致计数同样走该索引。
 */
// biz_date, seq, created_at 与日记账排序一致：分页取数 / 前页净额不再临时排序（深分页 4s → 百毫秒级）
const COVER_COLS = [
  'account_set_id', 'account_code', 'currency', 'biz_date', 'seq', 'created_at',
  'debit', 'credit', 'base_debit', 'base_credit', 'reconciled',
]

export function up(db: Database.Database): void {
  const has = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cashier_journal'").get()
  if (!has) return
  const cols = new Set((db.prepare('PRAGMA table_info(cashier_journal)').all() as Array<{ name: string }>).map(c => c.name))
  const indexCols = COVER_COLS.filter(c => cols.has(c))
  // 已存在但列不全（开发期早期版本）时重建
  const existing = (db.prepare("PRAGMA index_info('idx_cashier_journal_acct_cur_cover')").all() as Array<{ name: string }>).map(c => c.name)
  if (existing.length && existing.join(',') !== indexCols.join(',')) db.exec('DROP INDEX idx_cashier_journal_acct_cur_cover')
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_acct_cur_cover ON cashier_journal(${indexCols.join(', ')});
    DROP INDEX IF EXISTS idx_cashier_journal_acct_currency;
  `)
}

export function down(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_cashier_journal_acct_cur_cover;
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_acct_currency ON cashier_journal(account_set_id, account_code, currency);
  `)
}
