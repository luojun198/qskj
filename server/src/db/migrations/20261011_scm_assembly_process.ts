import type Database from 'better-sqlite3'

/**
 * 组装单加工方式 + 客供仓：
 *   scm_doc.process_mode            组装单加工方式：self(自行组装，NULL 同) / entrust(委托加工，加工费挂应付) / contract(受托加工，加工费挂应收)
 *   scm_ar_ap_log.arap_side         往来台账行的应收/应付归属（ar/ap）；NULL 时仍按 doc_type 推断。组装单同一类型两种方向都可能，必须显式写
 *   scm_warehouse.is_customer_supplied  客供仓：只记数量与往来单位，不计成本（出入库单价一律按 0）
 */
export function up(db: Database.Database) {
  const addCol = (table: string, col: string, ddl: string) => {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(c => c.name))
    if (!cols.has(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
      console.log(`✓ ${table} 增加 ${col} 列`)
    }
  }
  addCol('scm_doc', 'process_mode', 'process_mode TEXT')
  addCol('scm_ar_ap_log', 'arap_side', 'arap_side TEXT')
  addCol('scm_warehouse', 'is_customer_supplied', 'is_customer_supplied INTEGER NOT NULL DEFAULT 0')
}

export function down(_db: Database.Database) {
  // SQLite 不便 drop column；列保留无害
}
