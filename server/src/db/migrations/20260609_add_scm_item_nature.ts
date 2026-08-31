import type Database from 'better-sqlite3'

/**
 * 物料档案：新增 is_leaf（物料性质）字段
 * - is_leaf = 1：下级物料（末级，可在单据中直接使用）
 * - is_leaf = 0：统计物料（汇总级，仅用于分组统计）
 */
export function up(db: Database.Database) {
  try {
    db.prepare('ALTER TABLE scm_item ADD COLUMN is_leaf INTEGER NOT NULL DEFAULT 1').run()
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e
  }
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，此迁移不可回滚
}
