import type Database from 'better-sqlite3'

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === column)
}

/**
 * FIX-146 / P1-报表-5：迁移 v7 只给 init_balances 加了 opening_* / pre_book_* 列而没有回填。
 * 报表取数（reportBalance OPENING 分支）与账簿年初余额都从 opening_* 读，
 * 老库若在加列后从未重新保存期初，期初 / 年初余额整体归零。
 *
 * 回填规则：四列全 0 且 init_balance ≠ 0 的行，按行上的 direction 把 init_balance 拆到 opening_debit / opening_credit
 * （正数落科目方向侧，负数落对侧），与 yearClosing.splitSignedBalance 口径一致。
 */
export function up(db: Database.Database): void {
  if (!hasColumn(db, 'init_balances', 'opening_debit')) {
    console.log('⚠ init_balances 无 opening_debit 列，跳过回填')
    return
  }
  const result = db
    .prepare(
      `UPDATE init_balances
       SET opening_debit = CASE
             WHEN (direction = 'debit' AND init_balance > 0) OR (direction != 'debit' AND init_balance < 0)
               THEN ABS(init_balance) ELSE 0 END,
           opening_credit = CASE
             WHEN (direction = 'credit' AND init_balance > 0) OR (direction != 'credit' AND init_balance < 0)
               THEN ABS(init_balance) ELSE 0 END
       WHERE ABS(COALESCE(init_balance, 0)) > 0.005
         AND COALESCE(opening_debit, 0) = 0
         AND COALESCE(opening_credit, 0) = 0
         AND COALESCE(pre_book_debit, 0) = 0
         AND COALESCE(pre_book_credit, 0) = 0`
    )
    .run()
  console.log(`✓ init_balances.opening_* 已按 init_balance 回填 ${result.changes} 行`)
}

export function down(_db: Database.Database): void {
  console.log('⚠ 回填不可逆（无法区分回填行与手工行），无需回滚')
}
