import type Database from 'better-sqlite3'

/**
 * 生产模块增强 Phase 1：工作中心 + 工艺路线 + 报工（人工/制费成本地基）
 *
 * - scm_work_center：工作中心/工位，带工时人工费率、工时制费费率（报工按工时×费率算人工/制费）
 * - scm_routing / scm_routing_line：工艺路线（头绑成品 item_code；行=工序/工作中心/标准工时）
 * - 扩展已存在的 scm_work_report：加工作中心、人工/制费金额、成品行、状态/审核（原仅建表无接口）
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run() }
  catch (e: any) { if (!String(e.message).includes('duplicate column name')) throw e }
}

export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_work_center (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'inhouse',      -- inhouse 自制 / outsource 委外
      labor_rate REAL NOT NULL DEFAULT 0,            -- 工时人工费率（元/工时）
      overhead_rate REAL NOT NULL DEFAULT 0,         -- 工时制造费用费率（元/工时）
      enabled INTEGER NOT NULL DEFAULT 1,
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE IF NOT EXISTS scm_routing (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT,
      item_code TEXT NOT NULL,                       -- 成品物料
      status TEXT NOT NULL DEFAULT 'active',
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE IF NOT EXISTS scm_routing_line (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      routing_id TEXT NOT NULL REFERENCES scm_routing(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL DEFAULT 0,
      process_name TEXT NOT NULL,                    -- 工序名
      work_center_code TEXT,
      std_hours REAL NOT NULL DEFAULT 0,             -- 单件标准工时
      is_outsource INTEGER NOT NULL DEFAULT 0,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_routing_item ON scm_routing(account_set_id, item_code);
    CREATE INDEX IF NOT EXISTS idx_scm_routing_line ON scm_routing_line(routing_id);
  `)

  // 扩展报工台账（原表见 20260618_extend_scm_production）
  addColumn(db, 'scm_work_report', 'work_center_code TEXT')
  addColumn(db, 'scm_work_report', 'labor_amount REAL NOT NULL DEFAULT 0')       // 人工金额 = work_hours × labor_rate
  addColumn(db, 'scm_work_report', 'overhead_amount REAL NOT NULL DEFAULT 0')    // 制费金额 = work_hours × overhead_rate
  addColumn(db, 'scm_work_report', 'product_id TEXT')                            // 对应工单成品行 scm_production_plan_product.id
  addColumn(db, 'scm_work_report', "status TEXT NOT NULL DEFAULT 'draft'")       // draft/audited
  addColumn(db, 'scm_work_report', 'auditor TEXT')
  addColumn(db, 'scm_work_report', 'audited_at TEXT')

  console.log('✓ scm_work_center / scm_routing(+line) 已建；scm_work_report 已扩展工作中心与人工/制费列')
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS scm_routing_line; DROP TABLE IF EXISTS scm_routing; DROP TABLE IF EXISTS scm_work_center;')
  // scm_work_report 新增列保留（SQLite 不支持 DROP COLUMN）
}
