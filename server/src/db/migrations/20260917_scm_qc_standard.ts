import type Database from 'better-sqlite3'

/**
 * 2026-09-17 质检从「质量记录」升级为「质量管控」：物料检验标准（检验项 + 抽样方案）与逐项检验结果。
 *
 *  - scm_qc_standard        物料检验标准头：按 物料 + 检验类型（IQC/IPQC/FQC，空 = 通用）唯一；抽样方案与允收不良数
 *  - scm_qc_standard_item   检验项：数值型（上下限）或判定型；is_key 关键项不合格直接判不合格
 *  - scm_qc_line_result     质检单明细行的逐项结果（标准快照 + 实测值 + 判定）
 *  - 参数 scm:qc_required_for_receipt：采购入库审核前须有判定合格的已审核 IQC（与 FQC 参数同构）
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_qc_standard (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      item_code TEXT NOT NULL,
      qc_type TEXT NOT NULL DEFAULT '',
      name TEXT,
      sampling_mode TEXT NOT NULL DEFAULT 'full',
      sampling_value REAL NOT NULL DEFAULT 0,
      min_sample REAL NOT NULL DEFAULT 1,
      accept_defects REAL NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(account_set_id, item_code, qc_type)
    );
    CREATE TABLE IF NOT EXISTS scm_qc_standard_item (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      standard_id TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      method TEXT,
      value_type TEXT NOT NULL DEFAULT 'numeric',
      target REAL,
      lower_limit REAL,
      upper_limit REAL,
      unit TEXT,
      is_key INTEGER NOT NULL DEFAULT 1,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_qc_standard_item_std ON scm_qc_standard_item(standard_id);
    CREATE TABLE IF NOT EXISTS scm_qc_line_result (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      qc_line_id TEXT NOT NULL,
      standard_item_id TEXT,
      seq INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'numeric',
      target REAL,
      lower_limit REAL,
      upper_limit REAL,
      unit TEXT,
      is_key INTEGER NOT NULL DEFAULT 1,
      value_num REAL,
      value_bool INTEGER,
      passed INTEGER,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_qc_line_result_line ON scm_qc_line_result(qc_line_id);
  `)
  console.log('✓ 质检检验标准 / 检验项 / 逐项结果表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_qc_line_result; DROP TABLE IF EXISTS scm_qc_standard_item; DROP TABLE IF EXISTS scm_qc_standard')
}
