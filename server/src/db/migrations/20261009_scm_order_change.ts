import type Database from 'better-sqlite3'

/**
 * v158：采购 / 销售订单变更单（客户反馈：订单没有变更功能）。
 *
 * 已审核订单不直接改，走变更单：可增减数量（不低于已入库 / 已出库）、对未执行部分改单价、增删明细；
 * 草稿可改可删，审核即写回订单；before_json / after_json / diff_json 留痕，变更单单独成列表可追溯。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_order_change (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      change_no TEXT NOT NULL,
      change_date TEXT NOT NULL,
      reason TEXT,
      remark TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      diff_json TEXT NOT NULL DEFAULT '[]',
      maker TEXT,
      auditor TEXT,
      audited_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(account_set_id, change_no)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_order_change_doc ON scm_order_change(account_set_id, doc_id, status);
    CREATE INDEX IF NOT EXISTS idx_scm_order_change_type ON scm_order_change(account_set_id, doc_type, change_date);
  `)
  console.log('✓ 订单变更单表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_order_change')
}
