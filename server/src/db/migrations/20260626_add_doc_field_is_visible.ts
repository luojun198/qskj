import type Database from 'better-sqlite3'

/**
 * 单据自定义字段：新增「是否显示」开关列 is_visible。
 *
 * is_visible=0 表示字段已定义但在录入页不渲染（定义与历史值保留），
 * 与 is_enabled（=软删除）是两件事：is_enabled=0 软停用（从启用列表消失），
 * is_visible=0 仅隐藏渲染。缺省 1（显示）。
 */
export function up(db: Database.Database) {
  const cols = new Set((db.prepare('PRAGMA table_info(scm_doc_field_defs)').all() as any[]).map(c => c.name))
  if (!cols.has('is_visible')) {
    db.exec('ALTER TABLE scm_doc_field_defs ADD COLUMN is_visible INTEGER DEFAULT 1')
    console.log('✓ scm_doc_field_defs 增加 is_visible 列（默认 1）')
  }
}

export function down(db: Database.Database) {
  // SQLite 不便 drop column；列保留无害
}
