import type Database from 'better-sqlite3'

/**
 * 期末调汇：记录每个期间生成的调汇凭证，保证同一期间只生成一张、反调汇后可重做。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fx_revaluation_runs (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      voucher_id TEXT NOT NULL REFERENCES vouchers(id),
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, year, period)
    );
    CREATE INDEX IF NOT EXISTS idx_fx_revaluation_runs_voucher ON fx_revaluation_runs(voucher_id);
  `)
  console.log('✓ fx_revaluation_runs 已创建')
}

export function down(db: Database.Database): void {
  db.exec(`DROP TABLE IF EXISTS fx_revaluation_runs`)
}
