import type Database from 'better-sqlite3'

/**
 * 科目现金流量项目
 *
 * - cash_flow_items.kind：main 主表项目 / supplement 附表（补充资料·间接法）项目
 * - account_cash_flow_map：每个科目的 主表贷方 / 主表借方 / 附表贷方 / 附表借方 四个项目编码。
 *   现金流量表按「现金类科目 ↔ 对方科目」自动推算，凭证录入不再人工指定现金流量项目。
 *   没有行的科目继承最近一个有设置的上级；编码为 NULL 表示该方向明确不设。
 */
function hasTable(db: Database.Database, tableName: string): boolean {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName)
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === column)
}

export function up(db: Database.Database) {
  if (hasTable(db, 'cash_flow_items') && !hasColumn(db, 'cash_flow_items', 'kind')) {
    db.exec(`ALTER TABLE cash_flow_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'main'`)
  }

  if (!hasTable(db, 'account_cash_flow_map')) {
    db.exec(`
      CREATE TABLE account_cash_flow_map (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        main_credit_code TEXT,
        main_debit_code TEXT,
        supp_credit_code TEXT,
        supp_debit_code TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_set_id, account_id)
      );
    `)
  }
  console.log('✓ account_cash_flow_map')
}

export function down(db: Database.Database) {
  if (hasTable(db, 'account_cash_flow_map')) db.exec('DROP TABLE account_cash_flow_map')
}
