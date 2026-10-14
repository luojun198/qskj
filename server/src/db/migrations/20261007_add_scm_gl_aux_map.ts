import type Database from 'better-sqlite3'

/**
 * 进销存资料 ↔ 总账辅助核算项 对照表
 *
 * 进销存往来单位 / 部门 / 业务员与总账 aux_items 是两套档案，生成凭证时按「名称 / 编号完全一致」
 * 自动对应；对不上的由用户在「基础资料 → 业务凭证设置」里手工指定、采纳近似建议或自动新建，
 * 结果记在这里，优先于自动匹配。
 */
function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName)
  return !!row
}

export function up(db: Database.Database) {
  if (hasTable(db, 'scm_gl_aux_map')) return

  db.exec(`
    CREATE TABLE scm_gl_aux_map (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      source_type TEXT NOT NULL,       -- partner / dept / person
      source_code TEXT NOT NULL,       -- 往来单位编号 / 部门编码 / 业务员名称
      category_id TEXT NOT NULL,       -- aux_categories.id
      aux_item_id TEXT NOT NULL,       -- aux_items.id
      match_source TEXT NOT NULL DEFAULT 'manual', -- manual / confirmed / created
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, source_type, source_code, category_id)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_gl_aux_map_set ON scm_gl_aux_map(account_set_id, source_type);
  `)
  console.log('✓ scm_gl_aux_map')
}

export function down(db: Database.Database) {
  if (!hasTable(db, 'scm_gl_aux_map')) return
  db.exec('DROP TABLE scm_gl_aux_map')
}
