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
 * 总账数量核算：科目数量标记/计量单位 + 分录数量三件套 + 期初数量列
 *
 * 与外币核算（20260905_add_foreign_currency.ts）一一对称：
 *   accounts.is_quantity / quantity_unit      ↔ is_foreign / currency_code
 *   voucher_entries.quantity / unit_price / unit ↔ foreign_amount / exchange_rate / currency_code
 *   init_balances.qty_*（5 列）                ↔ foreign_*（5 列）
 *
 * 区别：数量**不进** account_balances，库存数量金额表从 voucher_entries 实时聚合，
 * 因此过账（voucherPosting）与余额重建（accountBalanceRebuild）无需改动。
 */
export function up(db: Database.Database): void {
  addColumnIfMissing(db, 'accounts', 'is_quantity', 'is_quantity INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'accounts', 'quantity_unit', 'quantity_unit TEXT')

  // 老库兜底：新库在 migration version 5 已加过这三列
  addColumnIfMissing(db, 'voucher_entries', 'quantity', 'quantity REAL DEFAULT 0')
  addColumnIfMissing(db, 'voucher_entries', 'unit_price', 'unit_price REAL DEFAULT 0')
  addColumnIfMissing(db, 'voucher_entries', 'unit', 'unit TEXT')

  addColumnIfMissing(db, 'init_balances', 'qty_init_balance', 'qty_init_balance REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'init_balances', 'qty_opening_debit', 'qty_opening_debit REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'init_balances', 'qty_opening_credit', 'qty_opening_credit REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'init_balances', 'qty_pre_book_debit', 'qty_pre_book_debit REAL NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'init_balances', 'qty_pre_book_credit', 'qty_pre_book_credit REAL NOT NULL DEFAULT 0')

  console.log('✓ 数量核算字段已添加')
}

export function down(_db: Database.Database): void {
  console.log('⚠ SQLite 不支持删列；accounts/voucher_entries/init_balances 的数量列需手动重建表移除')
}
