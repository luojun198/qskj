import type Database from 'better-sqlite3'

/**
 * 物料档案：多级树状结构支持
 *
 * - parent_id: 上级物料 ID（null=顶级）
 * - level: 级次（1=顶级，2=二级，…）
 * - 现有物料自动保持 level=1, parent_id=null
 */
export function up(db: Database.Database) {
  try { db.prepare('ALTER TABLE scm_item ADD COLUMN parent_id TEXT').run() } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e
  }
  try {
    db.prepare('ALTER TABLE scm_item ADD COLUMN level INTEGER NOT NULL DEFAULT 1').run()
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_scm_item_parent ON scm_item(account_set_id, parent_id)')
  } catch { /* index may exist */ }
}

export function down(db: Database.Database) {
  // SQLite 不支持 DROP COLUMN；此迁移不可回滚。parent_id 和 level 列为无数据损毁风险。
}
