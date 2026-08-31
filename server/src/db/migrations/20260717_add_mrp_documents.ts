import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

/** MRP 计算单来源快照。计算结果继续使用 scm_doc_line，以复用通用下推进度与行级追溯。 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_mrp_source (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      mrp_doc_id TEXT NOT NULL REFERENCES scm_doc(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_no TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_line_id TEXT,
      item_code TEXT NOT NULL,
      demand_qty REAL NOT NULL DEFAULT 0,
      allocated_net_qty REAL NOT NULL DEFAULT 0,
      need_date TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(mrp_doc_id, source_key)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_mrp_source_doc ON scm_mrp_source(mrp_doc_id);
    CREATE INDEX IF NOT EXISTS idx_scm_mrp_source_origin ON scm_mrp_source(account_set_id, source_kind, source_id);
  `)

  const accountSets = db.prepare('SELECT id FROM account_sets').all() as Array<{ id: string }>
  const insertType = db.prepare(`INSERT OR IGNORE INTO scm_doc_type
    (id,account_set_id,code,name,direction,affects_stock,affects_ar_ap,category,header_fields,line_fields,required_fields)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  for (const row of accountSets) {
    insertType.run(
      uuidv4(), row.id, 'MRP', 'MRP计算单', 'none', 0, 0, 'production',
      JSON.stringify(['date', 'operator', 'remark']),
      JSON.stringify(['item', 'qty', 'source_type', 'supplier', 'remark']),
      JSON.stringify([]),
    )
  }
  console.log('✓ scm_mrp_source / MRP计算单类型已创建')
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS scm_mrp_source;')
  db.prepare("DELETE FROM scm_doc_type WHERE code='MRP'").run()
}
