import type Database from 'better-sqlite3'

/**
 * 单据明细行增加「行角色」列 line_role：
 *   'product'   = 成品行（组装单成品行模式：成品入库 + 承载缺料下推的 source_line_id 行级记账）
 *   NULL / 其它 = 子件/普通行（兼容历史所有明细）
 *
 * 用于「组装单（AS）成品行模式」：缺料下推生成组装单时，成品行带 source_line_id，
 * 子件行按 BOM 展开；审核时成品行入库、子件行出库。无成品行的旧组装单仍走「子件反推成品」逻辑。
 */
export function up(db: Database.Database) {
  const cols = new Set((db.prepare('PRAGMA table_info(scm_doc_line)').all() as any[]).map(c => c.name))
  if (!cols.has('line_role')) {
    db.exec('ALTER TABLE scm_doc_line ADD COLUMN line_role TEXT')
    console.log('✓ scm_doc_line 增加 line_role 列（product=成品行 / NULL=子件行）')
  }
}

export function down(_db: Database.Database) {
  // SQLite 不便 drop column；列保留无害
}
