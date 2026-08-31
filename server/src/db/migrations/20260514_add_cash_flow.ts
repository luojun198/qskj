import Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  // 创建现金流量项目表
  db.exec(`
    CREATE TABLE IF NOT EXISTS cash_flow_items (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('inflow', 'outflow', 'neutral')),
      parent_code TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      is_leaf INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    )
  `);

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cash_flow_items_account_set 
    ON cash_flow_items(account_set_id);
    
    CREATE INDEX IF NOT EXISTS idx_cash_flow_items_code 
    ON cash_flow_items(account_set_id, code);
    
    CREATE INDEX IF NOT EXISTS idx_cash_flow_items_parent 
    ON cash_flow_items(account_set_id, parent_code);
  `);

  // 在voucher_entries表增加现金流向字段
  db.exec(`
    ALTER TABLE voucher_entries ADD COLUMN cash_flow_code TEXT;
    ALTER TABLE voucher_entries ADD COLUMN cash_flow_name TEXT;
  `);

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_voucher_entries_cash_flow
    ON voucher_entries(cash_flow_code);
  `);

  // 在accounts表增加现金流量核算标志
  db.exec(`
    ALTER TABLE accounts ADD COLUMN require_cash_flow INTEGER NOT NULL DEFAULT 0;
  `);

  console.log('✓ 现金流量项目表创建成功');
  console.log('✓ voucher_entries表增加现金流向字段成功');
  console.log('✓ accounts表增加现金流量核算标志成功');
}

export function down(db: Database.Database): void {
  // 删除索引
  db.exec(`
    DROP INDEX IF EXISTS idx_cash_flow_items_account_set;
    DROP INDEX IF EXISTS idx_cash_flow_items_code;
    DROP INDEX IF EXISTS idx_cash_flow_items_parent;
    DROP INDEX IF EXISTS idx_voucher_entries_cash_flow;
  `);

  // 删除现金流量项目表
  db.exec(`DROP TABLE IF EXISTS cash_flow_items`);

  // SQLite不支持直接删除列，需要重建表
  console.log('⚠ SQLite不支持删除列，需要手动处理voucher_entries表');
}
