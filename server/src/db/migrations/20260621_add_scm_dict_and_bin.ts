import type Database from 'better-sqlite3'

/**
 * 基础设置补缺（收发类别/运输方式/库位）：
 * - scm_doc.io_category：收发类别（其他出入库用），值取自参数字典 scm:io_categories
 * - scm_doc.transport_method：运输方式（销售/采购用），取自 scm:transport_methods
 * - scm_doc_line.bin_no：库位（参考用，不参与库存结存）
 * - scm_bin：库位档案（隶属仓库）
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run() }
  catch (e: any) { if (!String(e.message).includes('duplicate column name')) throw e }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_doc', 'io_category TEXT')
  addColumn(db, 'scm_doc', 'transport_method TEXT')
  addColumn(db, 'scm_doc_line', 'bin_no TEXT')
  db.prepare(`CREATE TABLE IF NOT EXISTS scm_bin (
    id TEXT PRIMARY KEY,
    account_set_id TEXT NOT NULL,
    warehouse_code TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT,
    remark TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run()
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS uq_scm_bin ON scm_bin(account_set_id, warehouse_code, code)`).run()
  console.log('✓ 基础设置补缺：io_category/transport_method/bin_no/scm_bin 已就绪')
}

export function down(db: Database.Database) {
  db.prepare('DROP TABLE IF EXISTS scm_bin').run()
  // SQLite 不支持 DROP COLUMN，保留新增列
}
