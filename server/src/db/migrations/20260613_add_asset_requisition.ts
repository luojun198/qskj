import type Database from 'better-sqlite3'

/**
 * v112：资产领用归还台账 + 资产卡片附件（P3）
 *
 * 领用归还：主流软件（用友 U8「资产使用登记」/ 金蝶 K3「资产领用单」）用它记录
 * 资产在人与部门之间的实物流转，与会计口径的「部门调拨」互补——领用不改账，
 * 但会回写卡片上的使用人/保管人/存放地点，并在部门变化时联动记一条部门调拨流水。
 *
 * 附件：结构照搬 cashier_attachments（20260605），把 journal_id 换成 asset_id。
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixed_asset_requisition (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      asset_no TEXT NOT NULL,
      -- out=领用出库，in=归还
      action TEXT NOT NULL CHECK(action IN ('out', 'in')),
      action_date TEXT NOT NULL,
      user_name TEXT,
      user_aux_id TEXT,
      dept_code TEXT,
      keeper TEXT,
      install_place TEXT,
      expect_return_date TEXT,
      condition_note TEXT,
      remark TEXT,
      operator TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_asset_req_asset
      ON fixed_asset_requisition(account_set_id, asset_no);
    CREATE INDEX IF NOT EXISTS idx_asset_req_date
      ON fixed_asset_requisition(account_set_id, action_date);

    CREATE TABLE IF NOT EXISTS fixed_asset_attachments (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES fixed_asset(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(account_set_id, filename)
    );

    CREATE INDEX IF NOT EXISTS idx_asset_attachments_asset
      ON fixed_asset_attachments(account_set_id, asset_id);
  `)
  console.log('✓ fixed_asset_requisition / fixed_asset_attachments 建表完成')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP TABLE IF EXISTS fixed_asset_attachments;
    DROP TABLE IF EXISTS fixed_asset_requisition;
  `)
}
