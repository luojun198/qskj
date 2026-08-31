import type Database from 'better-sqlite3'

/**
 * FIX-003 / P0-9
 * 为 init_balances 增加 source 字段，区分手工录入与年结自动生成：
 *   - manual          ：用户在「期初余额」页面手动录入或导入（默认值，保护不被反结账删除）
 *   - year_close_auto ：年度结账自动生成（仅这些行会被反结账自动删除）
 *
 * 迁移策略：新列默认 'manual'，已存在数据全部标记 'manual'。
 * 这是安全的：现有反结账操作不再会误删任何历史数据；下一次年结才会写入 'year_close_auto'。
 */

export function up(db: Database.Database) {
  const columns = db
    .prepare(`PRAGMA table_info(init_balances)`)
    .all() as Array<{ name: string }>
  const hasSource = columns.some(c => c.name === 'source')
  if (!hasSource) {
    db.exec(`ALTER TABLE init_balances ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`)
    console.log("✓ init_balances 已添加 source 字段（默认 'manual'）")
  } else {
    console.log("✓ init_balances.source 已存在，跳过")
  }
}

export function down(db: Database.Database) {
  // SQLite 不支持 DROP COLUMN（旧版本），用重建方式安全回滚
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE init_balances_rollback AS
      SELECT id, account_set_id, account_id, direction, year, period,
             init_balance, init_debit, init_credit, aux_item_id,
             opening_debit, opening_credit, pre_book_debit, pre_book_credit,
             created_at
      FROM init_balances;
    DROP TABLE init_balances;
    ALTER TABLE init_balances_rollback RENAME TO init_balances;
    PRAGMA foreign_keys = ON;
  `)
  console.log('✓ init_balances.source 已通过表重建回滚移除')
}
