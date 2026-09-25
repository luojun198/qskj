import type Database from 'better-sqlite3'

/**
 * FIX-260：出纳日记账支持外币（美元等）。
 * 日记账此前只有原币金额（debit / credit），外币科目录入后无法折算本位币，
 * 生成凭证时也把外币数直接当人民币入账。新增：
 *   exchange_rate 汇率（本位币恒为 1）、base_debit / base_credit 本位币金额。
 * 存量行全部是本位币，回填 base_* = 原币金额。
 */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === column)
}

function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

const COLUMNS: Array<[string, string]> = [
  ['exchange_rate', 'REAL NOT NULL DEFAULT 1'],
  ['base_debit', 'REAL NOT NULL DEFAULT 0'],
  ['base_credit', 'REAL NOT NULL DEFAULT 0'],
]

export function up(db: Database.Database): void {
  if (!hasTable(db, 'cashier_journal')) return
  let added = false
  for (const [col, type] of COLUMNS) {
    if (!hasColumn(db, 'cashier_journal', col)) {
      db.exec(`ALTER TABLE cashier_journal ADD COLUMN ${col} ${type}`)
      added = true
    }
  }
  if (added) {
    db.exec(`
      UPDATE cashier_journal
      SET base_debit = debit, base_credit = credit
      WHERE base_debit = 0 AND base_credit = 0 AND (debit <> 0 OR credit <> 0)
    `)
  }
  console.log('✓ cashier_journal 增加 exchange_rate / base_debit / base_credit（存量按汇率 1 回填）')
}

export function down(db: Database.Database): void {
  if (!hasTable(db, 'cashier_journal')) return
  for (const [col] of COLUMNS) {
    if (hasColumn(db, 'cashier_journal', col)) {
      db.exec(`ALTER TABLE cashier_journal DROP COLUMN ${col}`)
    }
  }
}
