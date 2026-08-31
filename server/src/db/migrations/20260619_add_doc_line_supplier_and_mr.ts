import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

/**
 * 缺料单（doc_type=MR）支持：
 * 1) scm_doc_line 增 supplier_code（行级供应商，缺料单按供应商拆采购订单用；其它单据为 null）。
 * 2) 为所有账套补种 MR「缺料单」单据类型（seedDocTypes 仅在类型缺失时跑，既有账套需在此补齐）。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_doc_line', 'supplier_code TEXT')

  const sets = db.prepare('SELECT id FROM account_sets').all() as Array<{ id: string }>
  const ins = db.prepare(
    `INSERT OR IGNORE INTO scm_doc_type
       (id, account_set_id, code, name, direction, affects_stock, affects_ar_ap, category, header_fields, line_fields, required_fields)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
  for (const s of sets) {
    ins.run(randomUUID(), s.id, 'MR', '缺料单', 'none', 0, 0, 'purchase', '[]', '["item","qty"]', '[]')
  }
  console.log(`✓ scm_doc_line.supplier_code 已加；MR 缺料单已补种到 ${sets.length} 个账套`)
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN；MR 类型保留
}
