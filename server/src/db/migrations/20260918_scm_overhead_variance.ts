import type Database from 'better-sqlite3'

/**
 * 2026-09-18 生产评审 C-6：制造费用 / 人工吸收差异月末结转记录。
 *  每期每科目（制造费用 / 应付职工薪酬）一行：SCM 吸收额、总账借贷发生、差异、结转方式（转主营成本 / 分摊到本期完工成品）、生成的凭证 / 结转单。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_overhead_variance_run (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      period TEXT NOT NULL,
      kind TEXT NOT NULL,
      account_code TEXT NOT NULL,
      absorbed REAL NOT NULL DEFAULT 0,
      gl_debit REAL NOT NULL DEFAULT 0,
      gl_credit REAL NOT NULL DEFAULT 0,
      variance REAL NOT NULL DEFAULT 0,
      method TEXT NOT NULL,
      target_account TEXT,
      voucher_id TEXT,
      doc_id TEXT,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      run_by TEXT,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_ohv_period ON scm_overhead_variance_run(account_set_id, period, kind);
  `)
  console.log('✓ 制费/人工吸收差异结转记录表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_overhead_variance_run')
}
