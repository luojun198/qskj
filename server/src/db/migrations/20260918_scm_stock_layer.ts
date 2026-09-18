import type Database from 'better-sqlite3'

/**
 * 2026-09-18 FIFO / LIFO 计价：库存成本层。
 *
 *  - scm_stock_layer      每笔入库形成一层（qty_in / qty_left / unit_cost），按 layer_date + seq 排序；
 *                         出库按先进先出（最早层先耗）或后进先出（最新层先耗）逐层扣减
 *  - scm_stock_layer_use  出库流水对各层的消耗明细，反审核按此恢复各层剩余数量
 *
 *  仅当 scm:costing_method 为 fifo / lifo 时写入；移动加权平均不产生层数据。
 *  切换到 FIFO/LIFO 时，已有结存但无层记录的物料在首次出库时按当前结存均价自动补一层「期初层」（doc_type='INIT'）。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_stock_layer (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      warehouse_code TEXT NOT NULL,
      item_code TEXT NOT NULL,
      layer_date TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      doc_type TEXT,
      doc_no TEXT,
      line_seq INTEGER,
      move_id TEXT,
      qty_in REAL NOT NULL DEFAULT 0,
      qty_left REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scm_stock_layer_stock ON scm_stock_layer(account_set_id, warehouse_code, item_code, layer_date, seq);
    CREATE INDEX IF NOT EXISTS idx_scm_stock_layer_move ON scm_stock_layer(move_id);
    CREATE TABLE IF NOT EXISTS scm_stock_layer_use (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      move_id TEXT NOT NULL,
      layer_id TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_scm_stock_layer_use_move ON scm_stock_layer_use(move_id);
    CREATE INDEX IF NOT EXISTS idx_scm_stock_layer_use_layer ON scm_stock_layer_use(layer_id);
  `)
  console.log('✓ 库存成本层（FIFO/LIFO）表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_stock_layer_use; DROP TABLE IF EXISTS scm_stock_layer')
}
