import type Database from 'better-sqlite3'

/**
 * FIX-259：银行对账单导入改为任意 Excel 列映射后，对账单需要承载银行流水里常见的
 * 摘要 / 对方户名 / 对方账号 / 余额 四列，便于对账页人工核对。
 */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === column)
}

function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

const COLUMNS: Array<[string, string]> = [
  ['summary', 'TEXT'],
  ['counter_name', 'TEXT'],
  ['counter_account', 'TEXT'],
  ['balance', 'REAL'],
]

export function up(db: Database.Database): void {
  if (!hasTable(db, 'bank_statement')) return
  for (const [col, type] of COLUMNS) {
    if (!hasColumn(db, 'bank_statement', col)) {
      db.exec(`ALTER TABLE bank_statement ADD COLUMN ${col} ${type}`)
    }
  }
  console.log('✓ bank_statement 增加 summary / counter_name / counter_account / balance')
}

export function down(db: Database.Database): void {
  if (!hasTable(db, 'bank_statement')) return
  for (const [col] of COLUMNS) {
    if (hasColumn(db, 'bank_statement', col)) {
      db.exec(`ALTER TABLE bank_statement DROP COLUMN ${col}`)
    }
  }
}
