import type Database from 'better-sqlite3'

/**
 * v167：进销存 ACD 独立导入（润衡 POS 备份 → 当前账套进销存）
 *
 * - scm_acd_import_batch：导入批次（文件名、选项、统计、核对报告）
 * - scm_doc / scm_item / scm_partner / scm_warehouse / scm_item_category / scm_unit
 *   增加 import_batch_id，标记由哪次导入写入，供撤销与追溯
 * - scm_doc.external_voucher：1 = 原系统已制证（导入的历史单据），不再在本系统生成凭证
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run() }
  catch (e: any) { if (!String(e.message).includes('duplicate column name')) throw e }
}

const BATCH_TABLES = ['scm_doc', 'scm_item', 'scm_partner', 'scm_warehouse', 'scm_item_category', 'scm_unit']

export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_acd_import_batch (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      file_name TEXT,
      company_name TEXT,
      options TEXT,                          -- JSON 导入选项
      stats TEXT,                            -- JSON 导入数量
      report TEXT,                           -- JSON 核对报告
      status TEXT NOT NULL DEFAULT 'done',   -- done / reverted
      operator TEXT,
      backup_file TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reverted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_acd_batch_set ON scm_acd_import_batch(account_set_id, created_at);
  `)
  for (const t of BATCH_TABLES) addColumn(db, t, 'import_batch_id TEXT')
  addColumn(db, 'scm_doc', 'external_voucher INTEGER NOT NULL DEFAULT 0')
  console.log('✓ 进销存 ACD 导入：scm_acd_import_batch + import_batch_id / external_voucher 已就绪')
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS scm_acd_import_batch')
  // SQLite 旧版本不支持 DROP COLUMN，新增列保留（均可空 / 有默认值，不影响旧逻辑）
}
