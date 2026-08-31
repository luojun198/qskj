import type Database from 'better-sqlite3'

/**
 * 批次/保质期（阶段4-4）：
 * - scm_item.batch_out_mode：批次物料出库扣减方式 fifo(先进先出，默认) | manual(手工选批)
 * - scm_stock_batch.produce_date：批次生产日期（配合 shelf_life_days 算到期）
 * - scm_batch_move：批次出入流水（支持 FIFO 拆批与反审核回退），与移动平均成本台账并行，
 *   仅做数量/保质期追溯，不参与成本计算（成本仍走 scm_stock 移动加权平均）。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run() }
  catch (e: any) { if (!String(e.message).includes('duplicate column name')) throw e }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_item', "batch_out_mode TEXT DEFAULT 'fifo'")
  addColumn(db, 'scm_stock_batch', 'produce_date TEXT')
  db.prepare(`CREATE TABLE IF NOT EXISTS scm_batch_move (
    id TEXT PRIMARY KEY,
    account_set_id TEXT NOT NULL,
    doc_id TEXT,
    doc_type TEXT,
    doc_no TEXT,
    line_seq INTEGER,
    warehouse_code TEXT NOT NULL,
    item_code TEXT NOT NULL,
    batch_no TEXT NOT NULL,
    direction TEXT NOT NULL,
    qty REAL NOT NULL,
    produce_date TEXT,
    expire_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run()
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_batch_move_doc ON scm_batch_move(account_set_id, doc_id)`).run()
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_batch_move_item ON scm_batch_move(account_set_id, warehouse_code, item_code, batch_no)`).run()
  console.log('✓ 批次追溯：batch_out_mode/produce_date/scm_batch_move 已就绪')
}

export function down(db: Database.Database) {
  db.prepare('DROP TABLE IF EXISTS scm_batch_move').run()
  // SQLite 不支持 DROP COLUMN，保留新增列
}
