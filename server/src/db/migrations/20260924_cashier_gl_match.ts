import type Database from 'better-sqlite3'

/**
 * FIX-262：出纳对账改为「出纳日记账 ↔ 总账已记账分录」。
 * - 新表 cashier_gl_match：一个批次（batch_id）内若干出纳行（side=cashier）与若干分录（side=gl）净额相等即对上；
 *   amount 为按对账币种（外币科目原币）计的有符号净额快照（借正贷负），用于识别分录被改后的失效批次。
 * - cashier_journal.reconciled 改义为「已与总账对上」；旧的银行勾对标记全部清零（bank_statement 表保留备查，不再参与计算）。
 */
function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === column)
}

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cashier_gl_match (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      account_code TEXT NOT NULL,
      currency TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('cashier', 'gl')),
      ref_id TEXT NOT NULL,
      amount REAL NOT NULL,
      match_type TEXT NOT NULL CHECK(match_type IN ('link', 'auto', 'manual')),
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cashier_gl_match_batch ON cashier_gl_match(account_set_id, account_code, batch_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_gl_match_ref ON cashier_gl_match(side, ref_id);
  `)
  if (hasTable(db, 'cashier_journal')) {
    const sets = ['reconciled=0']
    const where = ['reconciled<>0']
    if (hasColumn(db, 'cashier_journal', 'match_batch')) { sets.push('match_batch=NULL'); where.push('match_batch IS NOT NULL') }
    if (hasColumn(db, 'cashier_journal', 'bank_statement_id')) { sets.push('bank_statement_id=NULL'); where.push('bank_statement_id IS NOT NULL') }
    const r = db.prepare(`UPDATE cashier_journal SET ${sets.join(', ')} WHERE ${where.join(' OR ')}`).run()
    console.log(`✓ cashier_gl_match 建表；清除旧银行勾对标记 ${r.changes} 行`)
  }
}

export function down(db: Database.Database): void {
  // 旧银行勾对标记已清除，不回填
  db.exec('DROP TABLE IF EXISTS cashier_gl_match')
}
