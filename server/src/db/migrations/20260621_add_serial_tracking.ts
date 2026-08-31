import type Database from 'better-sqlite3'

/**
 * 序列号管理（收尾2）：
 * - scm_item.serial_flag：是否启用序列号管理
 * - scm_doc_line.serial_nos：本行录入的序列号（JSON 字符串数组）
 * - scm_serial：序列号当前状态登记（在库/已出库 + 所在仓 + 出入单据）
 * - scm_serial_move：序列号出入流水（支持反审核回退）
 * 与批次/成本台账并行，仅做单品追溯，不参与成本。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run() }
  catch (e: any) { if (!String(e.message).includes('duplicate column name')) throw e }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_item', 'serial_flag INTEGER DEFAULT 0')
  addColumn(db, 'scm_doc_line', 'serial_nos TEXT')
  db.prepare(`CREATE TABLE IF NOT EXISTS scm_serial (
    id TEXT PRIMARY KEY,
    account_set_id TEXT NOT NULL,
    item_code TEXT NOT NULL,
    serial_no TEXT NOT NULL,
    warehouse_code TEXT,
    status TEXT NOT NULL DEFAULT 'in_stock',
    in_doc_no TEXT,
    out_doc_no TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run()
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS uq_serial ON scm_serial(account_set_id, item_code, serial_no)`).run()
  db.prepare(`CREATE TABLE IF NOT EXISTS scm_serial_move (
    id TEXT PRIMARY KEY,
    account_set_id TEXT NOT NULL,
    doc_id TEXT,
    doc_type TEXT,
    doc_no TEXT,
    line_seq INTEGER,
    warehouse_code TEXT,
    item_code TEXT NOT NULL,
    serial_no TEXT NOT NULL,
    direction TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run()
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_serial_move_doc ON scm_serial_move(account_set_id, doc_id)`).run()
  console.log('✓ 序列号追溯：serial_flag/serial_nos/scm_serial/scm_serial_move 已就绪')
}

export function down(db: Database.Database) {
  db.prepare('DROP TABLE IF EXISTS scm_serial_move').run()
  db.prepare('DROP TABLE IF EXISTS scm_serial').run()
}
