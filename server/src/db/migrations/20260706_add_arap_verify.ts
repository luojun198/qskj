import type Database from 'better-sqlite3'

/**
 * 往来管理增强 Phase 0：单据级核销 + 预收预付 数据地基
 *
 * - scm_ar_ap_log 加列：
 *   · due_date        到期日（账龄按到期口径；生成时 = 单据到期日或 doc_date+账期，回填=doc_date）
 *   · verified_amount 本笔已核销金额（未核销额 = amount − verified_amount）
 *     - in 行未核销 = 未收/未付（进账龄/信用已用额度）
 *     - out 行未核销 = 预收/预付余额（可核销后续应收应付）
 * - 新表 scm_ar_ap_verify：核销明细，一行 = 用一笔收/付款(out) 核销一笔应收/应付(in)
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_ar_ap_log', 'due_date TEXT')
  addColumn(db, 'scm_ar_ap_log', 'verified_amount REAL NOT NULL DEFAULT 0')
  // 存量行：到期日回填为单据日期（保持旧账龄口径），已核销额默认 0
  db.prepare("UPDATE scm_ar_ap_log SET due_date = doc_date WHERE due_date IS NULL").run()
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_scm_arap_due ON scm_ar_ap_log(account_set_id, partner_code, due_date)')
  } catch { /* 索引可能已存在 */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_ar_ap_verify (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      partner_code TEXT NOT NULL,
      verify_no TEXT NOT NULL,
      verify_date TEXT,
      in_log_id TEXT NOT NULL REFERENCES scm_ar_ap_log(id) ON DELETE CASCADE,   -- 应收应付方
      out_log_id TEXT NOT NULL REFERENCES scm_ar_ap_log(id) ON DELETE CASCADE,  -- 收付款/预收预付方
      amount REAL NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scm_verify_in ON scm_ar_ap_verify(in_log_id);
    CREATE INDEX IF NOT EXISTS idx_scm_verify_out ON scm_ar_ap_verify(out_log_id);
    CREATE INDEX IF NOT EXISTS idx_scm_verify_no ON scm_ar_ap_verify(account_set_id, verify_no);
    CREATE INDEX IF NOT EXISTS idx_scm_verify_partner ON scm_ar_ap_verify(account_set_id, partner_code);
  `)
  console.log('✓ scm_ar_ap_log 已加 due_date/verified_amount；scm_ar_ap_verify 核销表已创建')
}

export function down(db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，保留 scm_ar_ap_log 新列（无害）；仅删核销表
  db.exec('DROP TABLE IF EXISTS scm_ar_ap_verify;')
}
