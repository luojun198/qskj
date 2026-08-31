import type Database from 'better-sqlite3'

/**
 * 单据明细行增加「成品分组」列 product_group（组装单多成品用）：
 *   组装单（AS）下——成品行存自己的组号；子件行存所属成品的组号。
 *   同组的「1 条成品行 + N 条子件行」构成一个成品的组装单元，成本按组归集
 *   （该成品单价 = 本组各子件出库成本之和 / 成品数量）。
 *   NULL = 未分组（兼容旧单：无成品行/单成品/全池摊成本的历史组装单）。
 */
export function up(db: Database.Database) {
  const cols = new Set((db.prepare('PRAGMA table_info(scm_doc_line)').all() as any[]).map(c => c.name))
  if (!cols.has('product_group')) {
    db.exec('ALTER TABLE scm_doc_line ADD COLUMN product_group INTEGER')
    console.log('✓ scm_doc_line 增加 product_group 列（组装单成品分组）')
  }
}

export function down(_db: Database.Database) {
  // SQLite 不便 drop column；列保留无害
}
