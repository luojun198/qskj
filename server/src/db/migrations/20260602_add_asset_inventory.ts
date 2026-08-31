import type Database from 'better-sqlite3'

/**
 * 固定资产盘点表
 *
 * inventory:     盘点主表（每次盘点一条记录）
 * inventory_item: 盘点明细（每项资产一行，含账面数和实盘数）
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixed_asset_inventory (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,                    -- 盘点名称（如"2026年半年度盘点"）
      inventory_date TEXT NOT NULL,          -- 盘点日期
      status TEXT NOT NULL DEFAULT 'draft',  -- draft / in_progress / completed
      total_count INTEGER NOT NULL DEFAULT 0,
      match_count INTEGER NOT NULL DEFAULT 0,
      surplus_count INTEGER NOT NULL DEFAULT 0,
      deficit_count INTEGER NOT NULL DEFAULT 0,
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_inventory_set ON fixed_asset_inventory(account_set_id);

    CREATE TABLE IF NOT EXISTS fixed_asset_inventory_item (
      id TEXT PRIMARY KEY,
      inventory_id TEXT NOT NULL REFERENCES fixed_asset_inventory(id) ON DELETE CASCADE,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      asset_no TEXT NOT NULL,
      asset_name TEXT,                       -- 盘点时快照
      category_name TEXT,
      dept_name TEXT,
      book_qty INTEGER NOT NULL DEFAULT 1,
      book_original_value REAL NOT NULL DEFAULT 0,
      book_accum_depr REAL NOT NULL DEFAULT 0,
      book_net_value REAL NOT NULL DEFAULT 0,
      actual_qty INTEGER NOT NULL DEFAULT 1, -- 实盘数量
      actual_status TEXT,                    -- 实盘状态(正常/盘盈/盘亏/损毁)
      difference_qty INTEGER NOT NULL DEFAULT 0,
      difference_note TEXT,                  -- 差异说明
      voucher_id TEXT,                       -- 关联盘盈/盘亏凭证
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_inventory_item_inv ON fixed_asset_inventory_item(inventory_id);
  `)
  console.log('✓ 固定资产盘点表已创建: fixed_asset_inventory + fixed_asset_inventory_item')
}

export function down(db: Database.Database) {
  db.exec(`DROP TABLE IF EXISTS fixed_asset_inventory_item`)
  db.exec(`DROP TABLE IF EXISTS fixed_asset_inventory`)
  console.log('✓ 固定资产盘点表已删除')
}
