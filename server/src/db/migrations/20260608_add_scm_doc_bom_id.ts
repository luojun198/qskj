import type { Database } from 'better-sqlite3'
import type { Migration } from '../migrations.js'

/** 供应链单据（scm_doc）新增 bom_id 字段（BOM 关联） */
export const up: Migration['up'] = (db: Database) => {
  try {
    db.prepare('ALTER TABLE scm_doc ADD COLUMN bom_id TEXT').run()
  } catch (e: any) {
    // 列已存在则跳过
    if (!String(e?.message || '').includes('duplicate column name')) throw e
  }
}

export const down: Migration['down'] = () => {
  // SQLite 不支持 DROP COLUMN，此迁移不可回滚；bom_id 列无数据损毁风险
}
