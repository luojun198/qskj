import type Database from 'better-sqlite3'

/**
 * 2026-09-17 综合评审 P1-5 / P1-11：出纳日记账的两条"真外键"。
 *
 * - bank_statement_id：勾对时记录对应的对账单。此前自动勾对全批共用一个 match_batch，
 *   撤销其中一条会把同批次全部对账单置回未匹配，而其余日记账仍是已对账，状态自相矛盾。
 * - voucher_id：生成 / 同步凭证时记录凭证 id。此前只靠 voucher_year/month/type/no 四个冗余号
 *   关联，凭证重排号 / 插号后日记账指向错误凭证，删除时找不到原凭证而成孤儿。
 *
 * 存量回填：bank_statement_id 按 match_batch 一一对应（同批次只有一对时才能确定）；
 * voucher_id 按 年/期/号 + source='cashier' 匹配。
 */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === column)
}

function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

export function up(db: Database.Database): void {
  if (!hasTable(db, 'cashier_journal')) return
  if (!hasColumn(db, 'cashier_journal', 'bank_statement_id')) {
    db.exec('ALTER TABLE cashier_journal ADD COLUMN bank_statement_id TEXT')
  }
  if (!hasColumn(db, 'cashier_journal', 'voucher_id')) {
    db.exec('ALTER TABLE cashier_journal ADD COLUMN voucher_id TEXT')
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_voucher_id ON cashier_journal(voucher_id);
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_bank_statement_id ON cashier_journal(bank_statement_id);
  `)

  // 回填 bank_statement_id：同一 match_batch 下恰好一条日记账对一条对账单时才能确定
  let linked = 0
  if (hasTable(db, 'bank_statement')) {
    linked = db
      .prepare(
        `UPDATE cashier_journal SET bank_statement_id = (
           SELECT bs.id FROM bank_statement bs
            WHERE bs.account_set_id = cashier_journal.account_set_id
              AND bs.match_batch IS NOT NULL
              AND CAST(bs.match_batch AS TEXT) = CAST(cashier_journal.match_batch AS TEXT)
              AND (SELECT COUNT(*) FROM bank_statement b2
                    WHERE b2.account_set_id = bs.account_set_id
                      AND CAST(b2.match_batch AS TEXT) = CAST(bs.match_batch AS TEXT)) = 1
              AND (SELECT COUNT(*) FROM cashier_journal j2
                    WHERE j2.account_set_id = cashier_journal.account_set_id
                      AND CAST(j2.match_batch AS TEXT) = CAST(cashier_journal.match_batch AS TEXT)) = 1
            LIMIT 1)
         WHERE reconciled = 1 AND bank_statement_id IS NULL AND match_batch IS NOT NULL`
      )
      .run().changes
  }

  // 回填 voucher_id：年 / 期 / 号 + source='cashier' 唯一匹配
  let vouchers = 0
  if (hasTable(db, 'vouchers')) {
    vouchers = db
      .prepare(
        `UPDATE cashier_journal SET voucher_id = (
           SELECT v.id FROM vouchers v
            WHERE v.account_set_id = cashier_journal.account_set_id
              AND v.year = cashier_journal.voucher_year
              AND v.period = cashier_journal.voucher_month
              AND CAST(v.voucher_no AS TEXT) = CAST(cashier_journal.voucher_no AS TEXT)
              AND v.source = 'cashier'
            LIMIT 1)
         WHERE voucher_id IS NULL AND voucher_no IS NOT NULL AND voucher_no <> ''`
      )
      .run().changes
  }
  console.log(`✓ cashier_journal 增加 bank_statement_id / voucher_id；回填对账单关联 ${linked} 行、凭证关联 ${vouchers} 行`)
}

export function down(db: Database.Database): void {
  // SQLite 3.35+ 支持 DROP COLUMN；列上有索引需先删索引
  db.exec(`
    DROP INDEX IF EXISTS idx_cashier_journal_voucher_id;
    DROP INDEX IF EXISTS idx_cashier_journal_bank_statement_id;
  `)
  try {
    db.exec('ALTER TABLE cashier_journal DROP COLUMN bank_statement_id')
    db.exec('ALTER TABLE cashier_journal DROP COLUMN voucher_id')
  } catch {
    console.log('⚠ 当前 SQLite 不支持 DROP COLUMN，保留列（不影响使用）')
  }
}
