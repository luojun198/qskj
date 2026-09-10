import type Database from 'better-sqlite3'

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === column)
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

/**
 * 总账外币核算：币种/汇率主数据 + 科目/分录/期初/余额表外币列
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS currencies (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_base INTEGER NOT NULL DEFAULT 0,
      default_rate REAL NOT NULL DEFAULT 1,
      rate_decimals INTEGER NOT NULL DEFAULT 4,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      currency_code TEXT NOT NULL,
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      rate REAL NOT NULL DEFAULT 1,
      closing_rate REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, currency_code, year, period)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_currencies_account_set
      ON currencies(account_set_id);
    CREATE INDEX IF NOT EXISTS idx_exchange_rates_account_set
      ON exchange_rates(account_set_id, currency_code, year, period);
  `)

  addColumnIfMissing(db, 'accounts', 'is_foreign', 'is_foreign INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'accounts', 'currency_code', 'currency_code TEXT')

  addColumnIfMissing(db, 'voucher_entries', 'currency_code', 'currency_code TEXT')
  addColumnIfMissing(db, 'voucher_entries', 'exchange_rate', 'exchange_rate REAL')
  addColumnIfMissing(db, 'voucher_entries', 'foreign_amount', 'foreign_amount REAL')

  addColumnIfMissing(db, 'init_balances', 'foreign_init_balance', 'foreign_init_balance REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'init_balances', 'foreign_opening_debit', 'foreign_opening_debit REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'init_balances', 'foreign_opening_credit', 'foreign_opening_credit REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'init_balances', 'foreign_pre_book_debit', 'foreign_pre_book_debit REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'init_balances', 'foreign_pre_book_credit', 'foreign_pre_book_credit REAL NOT NULL DEFAULT 0')

  addColumnIfMissing(db, 'account_balances', 'foreign_init_balance', 'foreign_init_balance REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'account_balances', 'foreign_current_debit', 'foreign_current_debit REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'account_balances', 'foreign_current_credit', 'foreign_current_credit REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'account_balances', 'foreign_end_balance', 'foreign_end_balance REAL NOT NULL DEFAULT 0')

  console.log('✓ 外币核算表与字段已添加')
}

export function down(db: Database.Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_exchange_rates_account_set`)
  db.exec(`DROP INDEX IF EXISTS idx_currencies_account_set`)
  db.exec(`DROP TABLE IF EXISTS exchange_rates`)
  db.exec(`DROP TABLE IF EXISTS currencies`)
  console.log('⚠ 外币主数据表已删除；accounts/voucher_entries/init_balances/account_balances 外币列需手动重建表移除')
}
