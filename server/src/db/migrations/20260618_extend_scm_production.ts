import type Database from 'better-sqlite3'

/**
 * Phase 4：生产 / 委外链路字段补全
 *
 * scm_production_plan 扩展生产计划常用字段（BOM、关联订单、优先级、原料/成品仓、完工/报废数量）；
 * 兼容 ACD scjh（生产计划）的 ckbh_yl/ckbh_cp 等字段语义。
 * 委外加工费/损耗率已在 scm_doc_line 上扩展（见 20260618_extend_scm_doc_fields）。
 * 预留 scm_work_report 报工台账表（本期仅建表，UI 二期）。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  // ── 生产计划扩展（← scjh1/2/3） ──
  addColumn(db, 'scm_production_plan', "bom_id TEXT")               // 关联 BOM
  addColumn(db, 'scm_production_plan', "source_doc_id TEXT")        // 关联销售订单
  addColumn(db, 'scm_production_plan', "dept_code TEXT")            // 生产部门
  addColumn(db, 'scm_production_plan', "priority INTEGER DEFAULT 0")// 优先级
  addColumn(db, 'scm_production_plan', "finished_qty REAL DEFAULT 0") // 已完工数量
  addColumn(db, 'scm_production_plan', "scrap_qty REAL DEFAULT 0")  // 报废数量
  addColumn(db, 'scm_production_plan', "yl_warehouse TEXT")         // ckbh_yl 原料仓
  addColumn(db, 'scm_production_plan', "fp_warehouse TEXT")         // ckbh_cp 成品仓

  // ── 报工台账（预留，← scbg1/2；本期仅建表） ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_work_report (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      plan_id TEXT,                       -- 关联生产计划
      report_no TEXT,                     -- 报工单号
      report_date TEXT,
      item_code TEXT,                     -- 报工成品
      process_name TEXT,                  -- 工序
      qty REAL NOT NULL DEFAULT 0,        -- 合格数量
      scrap_qty REAL NOT NULL DEFAULT 0,  -- 不良数量
      work_hours REAL DEFAULT 0,          -- 工时
      operator TEXT,
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scm_work_report_set ON scm_work_report(account_set_id, plan_id);
  `)

  console.log('✓ scm_production_plan 已扩展；scm_work_report 报工台账已预留')
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS scm_work_report;')
  // scm_production_plan 新增列保留（SQLite 不支持 DROP COLUMN）
}
