import type Database from 'better-sqlite3'

/** v52：供应链往来台账 + BOM 骨架 + 生产计划 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_ar_ap_log (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      partner_code TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      doc_no TEXT NOT NULL,
      doc_date TEXT,
      direction TEXT NOT NULL,         -- in(收)/out(付)
      amount REAL NOT NULL DEFAULT 0,
      ar_account TEXT,
      ap_account TEXT,
      cashier_journal_id TEXT,
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scm_arap ON scm_ar_ap_log(account_set_id, partner_code, doc_date);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_bom (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT,
      item_code TEXT NOT NULL,          -- 成品/父项物料
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_bom_line (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      bom_id TEXT NOT NULL REFERENCES scm_bom(id) ON DELETE CASCADE,
      seq INTEGER,
      item_code TEXT NOT NULL,          -- 子项物料
      qty REAL NOT NULL DEFAULT 0,      -- 用量
      unit TEXT,
      scrap_rate REAL DEFAULT 0,        -- 损耗率%
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_bom_line ON scm_bom_line(bom_id);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_production_plan (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,               -- 计划号
      item_code TEXT NOT NULL,          -- 生产成品
      plan_qty REAL NOT NULL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
  `)

  console.log('✓ scm_ar_ap_log / scm_bom(+line) / scm_production_plan 已创建')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP TABLE IF EXISTS scm_production_plan;
    DROP TABLE IF EXISTS scm_bom_line;
    DROP TABLE IF EXISTS scm_bom;
    DROP TABLE IF EXISTS scm_ar_ap_log;
  `)
}
