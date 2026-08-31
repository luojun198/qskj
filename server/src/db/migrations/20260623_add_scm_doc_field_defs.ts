import type Database from 'better-sqlite3'

/**
 * 业务单据 表头/表尾 自定义字段定义表
 *
 * scm_doc_field_defs：按 账套 + 单据类型(doc_type) + 位置(position: header/footer) 声明自定义字段。
 * 值复用现有 scm_doc.field_values JSON 列（{field_key: value}）；表头/表尾共用同一 JSON，
 * 故 field_key 在 (账套, 单据类型) 内唯一即可，天然不撞键。
 * 仿物料档案 scm_item_field_defs（20260609_add_scm_item_custom_fields.ts）。
 */
export function up(db: Database.Database) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS scm_doc_field_defs (
      id             TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      doc_type       TEXT NOT NULL,
      position       TEXT NOT NULL DEFAULT 'header',
      field_key      TEXT NOT NULL,
      field_name     TEXT NOT NULL,
      field_type     TEXT NOT NULL DEFAULT 'text',
      options_json   TEXT,
      sort_order     INTEGER DEFAULT 0,
      is_enabled     INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now','localtime')),
      updated_at     TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(account_set_id, doc_type, field_key)
    )
  `).run()
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_scm_doc_field_defs_lookup
    ON scm_doc_field_defs(account_set_id, doc_type, is_enabled)`).run()
  console.log('✓ scm_doc_field_defs 表已创建（单据表头/表尾自定义字段定义）')
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS scm_doc_field_defs')
}
