import type Database from 'better-sqlite3'

/**
 * 单据表头默认税率 scm_doc.tax_rate：明细行未填税率时回退表头税率（与「仓库表头兜底」一致）。
 * 前端按 行税率 ?? 表头税率 计算税额并落库为具体值；表头税率仅作默认/兜底。
 */
export function up(db: Database.Database) {
  try {
    db.prepare('ALTER TABLE scm_doc ADD COLUMN tax_rate REAL DEFAULT 0').run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
  console.log('✓ scm_doc 已增加 tax_rate（表头默认税率，行税率兜底）')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，保留列即可
}
