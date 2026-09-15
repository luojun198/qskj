import type Database from 'better-sqlite3'

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === column)
}

/**
 * FIX-143 / GL-09 / P1-报表-6：凭证类型「结转」标志化。
 *
 * 此前账簿科目分析、报表 @jqy、间接法净利润、静态现金流量表都靠 `voucher_types.name = '结转'`
 * 字面量识别结转凭证；ACD 导入的账套常见「结转结余」「转账」等名称，字面量匹配漏排，
 * 结转分录被重复计入损益。改为 `is_closing` 标志，名称含「结转」的历史类型自动打标。
 */
export function up(db: Database.Database): void {
  if (!hasColumn(db, 'voucher_types', 'is_closing')) {
    db.exec(`ALTER TABLE voucher_types ADD COLUMN is_closing INTEGER NOT NULL DEFAULT 0`)
  }
  db.exec(`UPDATE voucher_types SET is_closing = 1 WHERE is_closing = 0 AND name LIKE '%结转%'`)
  console.log('✓ voucher_types.is_closing 已添加并按名称回填')
}

export function down(_db: Database.Database): void {
  console.log('⚠ SQLite 不支持删列；voucher_types.is_closing 需手动重建表移除')
}
