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
 * 外币类型：币种表增加「年初汇率 / 期末汇率」两列（对齐传统外币管理界面）。
 * 历史数据用 default_rate 回填。
 */
export function up(db: Database.Database): void {
  const hadBegin = hasColumn(db, 'currencies', 'begin_rate')
  const hadEnd = hasColumn(db, 'currencies', 'end_rate')
  addColumnIfMissing(db, 'currencies', 'begin_rate', 'begin_rate REAL NOT NULL DEFAULT 1')
  addColumnIfMissing(db, 'currencies', 'end_rate', 'end_rate REAL NOT NULL DEFAULT 1')
  if (!hadBegin) db.exec(`UPDATE currencies SET begin_rate = default_rate`)
  if (!hadEnd) db.exec(`UPDATE currencies SET end_rate = default_rate`)
  console.log('✓ currencies 已增加 begin_rate / end_rate')
}

export function down(_db: Database.Database): void {
  console.log('⚠ currencies.begin_rate / end_rate 需手动重建表移除')
}
