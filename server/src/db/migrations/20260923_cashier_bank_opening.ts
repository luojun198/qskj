import type Database from 'better-sqlite3'

/**
 * FIX-261：
 * 1. 出纳期初增加「银行对账单期初余额」bank_balance（NULL = 未填，余额调节表按账面期初处理）。
 *    此前余额调节表的银行余额只是对账单行借贷净额，有期初余额的科目调节后永远差一个期初数。
 * 2. 数据修复：手工录入的日记账 seq 一直写 0（接口默认值），按「日期 + 创建时间」接在各科目现有最大序号之后补号。
 */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === column)
}

function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

export function up(db: Database.Database): void {
  if (hasTable(db, 'cashier_init_balance') && !hasColumn(db, 'cashier_init_balance', 'bank_balance')) {
    db.exec('ALTER TABLE cashier_init_balance ADD COLUMN bank_balance REAL')
  }

  if (hasTable(db, 'cashier_journal')) {
    const groups = db.prepare(`
      SELECT account_set_id, account_code, currency, COALESCE(MAX(seq), 0) AS max_seq
      FROM cashier_journal
      GROUP BY account_set_id, account_code, currency
      HAVING SUM(CASE WHEN COALESCE(seq, 0) <= 0 THEN 1 ELSE 0 END) > 0
    `).all() as Array<{ account_set_id: string; account_code: string; currency: string; max_seq: number }>
    const pick = db.prepare(`
      SELECT id FROM cashier_journal
      WHERE account_set_id=? AND account_code=? AND currency=? AND COALESCE(seq, 0) <= 0
      ORDER BY biz_date, created_at, id
    `)
    const upd = db.prepare('UPDATE cashier_journal SET seq=? WHERE id=?')
    let fixed = 0
    db.transaction(() => {
      for (const g of groups) {
        let next = Math.max(0, Number(g.max_seq) || 0)
        for (const r of pick.all(g.account_set_id, g.account_code, g.currency) as Array<{ id: string }>) {
          upd.run(++next, r.id)
          fixed++
        }
      }
    })()
    console.log(`✓ cashier_init_balance 增加 bank_balance；日记账补序号 ${fixed} 行`)
  }
}

export function down(db: Database.Database): void {
  // 补出的序号不回退（回退无意义且会重新产生重复的 0）
  if (hasTable(db, 'cashier_init_balance') && hasColumn(db, 'cashier_init_balance', 'bank_balance')) {
    db.exec('ALTER TABLE cashier_init_balance DROP COLUMN bank_balance')
  }
}
