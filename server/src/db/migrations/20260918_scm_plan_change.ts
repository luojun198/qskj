import type Database from 'better-sqlite3'

/**
 * 2026-09-18 生产评审 C-1：工单变更单。
 *
 *  已审核（released）工单不能直接编辑，追加 / 减少计划数、改交期、增删换用料走变更单：
 *  草稿可改可删，审核即生效写回工单；before_json / after_json / diff_json 留痕，审核后不可反审核（再改再开一张）。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_production_plan_change (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_scm_plan_change_plan ON scm_production_plan_change(account_set_id, plan_id, status);
  `)
  console.log('✓ 工单变更单表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_production_plan_change')
}
