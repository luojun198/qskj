import type Database from 'better-sqlite3'

/**
 * 2026-09-18 全月平均 / 指定成本（个别计价）。
 *
 *  - scm_stock_layer.batch_no：指定成本按批次识别入库层，出库行指定批次即取该批次的入库成本
 *  - scm_costing_period：全月平均的期末成本计算记录（每账套每期一行）；期内再有出入库审核/反审核时置为 stale 提示重算
 */
export function up(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info('scm_stock_layer')").all() as { name: string }[]
  if (!cols.some(c => c.name === 'batch_no')) db.exec('ALTER TABLE scm_stock_layer ADD COLUMN batch_no TEXT')
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_costing_period (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      period TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'month_avg',
      status TEXT NOT NULL DEFAULT 'calculated',
      item_count INTEGER NOT NULL DEFAULT 0,
      out_delta REAL NOT NULL DEFAULT 0,
      summary_json TEXT,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now')),
      calculated_by TEXT,
      UNIQUE(account_set_id, period)
    );
  `)
  console.log('✓ 成本层批次列 / 全月平均计算期间表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_costing_period')
}
