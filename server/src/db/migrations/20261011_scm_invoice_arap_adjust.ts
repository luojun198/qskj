import type Database from 'better-sqlite3'

/**
 * v162：发票按行校正来源单暂估往来的调整记录（第四份反馈 Q7：一张发票可对应多张源单、同一源单可分批开票）。
 *
 * 原发票只认表头单一 source_doc_id，审核时把来源单台账整笔改成发票额、反审核时按来源单全部行还原，
 * 多源 / 分批开票会算错。改为按行计差额，累加到各来源单的台账上，每张来源单记一条调整记录，
 * 反审核按记录逐笔回减。历史发票（没有调整记录）仍按原逻辑还原。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_invoice_arap_adjust (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      invoice_id TEXT,
      invoice_no TEXT NOT NULL,
      src_doc_id TEXT NOT NULL,
      src_log_id TEXT NOT NULL,
      delta_fc REAL NOT NULL DEFAULT 0,
      delta_base REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scm_invoice_arap_adjust_inv ON scm_invoice_arap_adjust(account_set_id, invoice_id);
    CREATE INDEX IF NOT EXISTS idx_scm_invoice_arap_adjust_src ON scm_invoice_arap_adjust(account_set_id, src_doc_id);
  `)
  console.log('✓ 发票往来调整记录表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_invoice_arap_adjust')
}
