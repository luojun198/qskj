import type Database from 'better-sqlite3'

/**
 * 2026-09-17 进销存多币种双轨收尾：往来台账期末汇率重估记录。
 *
 * 总账「期末调汇」按科目外币余额生成汇兑损益凭证（含供应链外币应收/应付分录）；
 * 供应链往来台账的本位币 amount 仍停在入账汇率，往来余额表/账龄（本位币）就会与 1122/2202 差一个调汇额。
 * 本表记录每次「往来汇率重估」改动了哪些台账行（旧/新本位币金额与汇率），供撤销恢复。
 * 不生成凭证——凭证由总账期末调汇统一出。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_fx_revaluation (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      rates_json TEXT NOT NULL,
      lines_json TEXT NOT NULL,
      total_adjustment REAL NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_fx_reval_set_period ON scm_fx_revaluation(account_set_id, year, period);
  `)
  console.log('✓ scm_fx_revaluation 表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_fx_revaluation')
}
