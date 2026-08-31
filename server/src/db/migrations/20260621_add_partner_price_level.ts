import type Database from 'better-sqlite3'

/**
 * 多级售价（阶段4-2）：为 scm_partner 增加 price_level（价格等级）。
 * 1=一级售价(sale_price)、2=二级(sale_price2)、3=三级(sale_price3)，默认 1。
 * 销售开单时按客户价格等级自动带出对应档售价。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  addColumn(db, 'scm_partner', 'price_level INTEGER DEFAULT 1')
  console.log('✓ scm_partner.price_level 已添加（多级售价价格等级）')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN；保留列
}
