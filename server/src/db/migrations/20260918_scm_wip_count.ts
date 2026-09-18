import type Database from 'better-sqlite3'

/**
 * 2026-09-18 生产评审 C-5：在制品盘点。
 *  - scm_plan_wip_count       盘点头：工单 / 盘点号 / 日期 / 状态（draft / audited）
 *  - scm_plan_wip_count_line  盘点行：物料 / 账面在制数 / 实盘数 / 差异（实盘 − 账面）
 *  账面在制数 = 工单净领用 − Σ(已完工+已报废)×单件用量(含损耗) − 已审核盘亏
 *  审核：盘盈（现场多）生成退料单草稿退回原料仓；盘亏（现场少）记为在制损耗，领料建议按损耗补领；损耗成本留在在制随末批吸收
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_plan_wip_count (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      count_no TEXT NOT NULL,
      count_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      remark TEXT,
      return_doc_id TEXT,
      maker TEXT,
      auditor TEXT,
      audited_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(account_set_id, count_no)
    );
    CREATE TABLE IF NOT EXISTS scm_plan_wip_count_line (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      count_id TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      item_code TEXT NOT NULL,
      book_qty REAL NOT NULL DEFAULT 0,
      counted_qty REAL NOT NULL DEFAULT 0,
      diff_qty REAL NOT NULL DEFAULT 0,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_wip_count_plan ON scm_plan_wip_count(account_set_id, plan_id, status);
    CREATE INDEX IF NOT EXISTS idx_scm_wip_count_line ON scm_plan_wip_count_line(count_id);
  `)
  console.log('✓ 在制盘点表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_plan_wip_count_line; DROP TABLE IF EXISTS scm_plan_wip_count')
}
