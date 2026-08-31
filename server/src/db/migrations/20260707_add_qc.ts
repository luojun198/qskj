import type Database from 'better-sqlite3'

/**
 * 生产模块增强 Phase 2：质检（IQC 到货 / IPQC 过程 / FQC 完工）+ 不良追溯
 *
 * scm_qc_doc：质检单头（关联来源单据：采购入库 PI / 完工入库 PF / 工单）
 * scm_qc_line：质检明细（物料/批号/检验数/合格/不良/不良原因）
 * 提供质量记录与不良来源追溯；不做自动库存移动（不良品仍走既有 PS 不良品入库）。
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_qc_doc (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      qc_no TEXT NOT NULL,
      qc_type TEXT NOT NULL DEFAULT 'IQC',        -- IQC 到货 / IPQC 过程 / FQC 完工
      qc_date TEXT,
      source_doc_type TEXT,                        -- 来源单据类型 PI/PF/工单
      source_doc_id TEXT,
      source_doc_no TEXT,
      partner_code TEXT,                           -- 供应商(IQC)
      inspector TEXT,
      result TEXT NOT NULL DEFAULT 'pass',         -- pass 合格 / fail 不合格 / concession 让步接收
      status TEXT NOT NULL DEFAULT 'draft',        -- draft / audited
      auditor TEXT,
      audited_at TEXT,
      remark TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, qc_no)
    );
    CREATE TABLE IF NOT EXISTS scm_qc_line (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      qc_doc_id TEXT NOT NULL REFERENCES scm_qc_doc(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL DEFAULT 0,
      item_code TEXT NOT NULL,
      batch_no TEXT,
      inspect_qty REAL NOT NULL DEFAULT 0,
      qualified_qty REAL NOT NULL DEFAULT 0,
      defect_qty REAL NOT NULL DEFAULT 0,
      defect_reason TEXT,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_qc_doc_set ON scm_qc_doc(account_set_id, qc_type, qc_date);
    CREATE INDEX IF NOT EXISTS idx_scm_qc_doc_src ON scm_qc_doc(account_set_id, source_doc_id);
    CREATE INDEX IF NOT EXISTS idx_scm_qc_line ON scm_qc_line(qc_doc_id);
  `)
  console.log('✓ scm_qc_doc / scm_qc_line 质检单表已创建')
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS scm_qc_line; DROP TABLE IF EXISTS scm_qc_doc;')
}
