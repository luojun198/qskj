import type Database from 'better-sqlite3'

/**
 * 物料档案：自定义字段支持
 * - scm_item 表新增 field_values 列（JSON字符串，存储自定义字段值）
 * - 新建 scm_item_field_defs 表（存储字段定义，按账套隔离）
 */
export function up(db: Database.Database) {
  // 1. scm_item 增加 field_values 列
  try {
    db.prepare("ALTER TABLE scm_item ADD COLUMN field_values TEXT NOT NULL DEFAULT '{}'").run()
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e
  }

  // 2. 新建字段定义表
  db.prepare(`
    CREATE TABLE IF NOT EXISTS scm_item_field_defs (
      id             TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      field_key      TEXT NOT NULL,
      field_name     TEXT NOT NULL,
      field_type     TEXT NOT NULL DEFAULT 'text',
      options_json   TEXT,
      sort_order     INTEGER DEFAULT 0,
      is_enabled     INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now','localtime')),
      updated_at     TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(account_set_id, field_key)
    )
  `).run()
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN；scm_item_field_defs 表保留
}
